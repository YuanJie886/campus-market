package com.lulu.campusmarketbackend.supply;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.SupplyMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 服务端发布草稿（5.1A / 5.2）。
 *
 * <p>状态机：DRAFT ⇄ READY → PUBLISHED；DRAFT / READY → DISCARDED（软丢弃）；DRAFT / READY 到期 → EXPIRED。
 * 后三者只读（数据库触发器同样保证）。所有写入都带乐观锁：客户端提交读到的 version，不一致即 409，
 * 另一个标签页或协助人的修改不会被静默覆盖。
 *
 * <p>可见性：只有所有者与持有生效邀请的协助人能读写，其他人一律 404。草稿不进入市场、搜索或需求匹配。
 */
@Service
public class ListingDraftService {

    public static final int EXPIRY_DAYS = 30;
    private static final Set<String> CREATE_FIELDS = Set.of("draftType", "payload");
    private static final Set<String> PATCH_FIELDS = Set.of("expectedVersion", "payload", "status");

    private final SupplyMapper supply;
    private final ListingValidator validator;
    private final RateLimitService rateLimit;
    private final ObjectMapper json;
    private final com.lulu.campusmarketbackend.image.ImagePolicy imagePolicy;
    private final com.lulu.campusmarketbackend.image.ImageService uploadedImages;
    private final com.lulu.campusmarketbackend.image.ImageUrlSigner imageUrls;

    public ListingDraftService(SupplyMapper supply, ListingValidator validator, RateLimitService rateLimit, ObjectMapper json,
                               com.lulu.campusmarketbackend.image.ImagePolicy imagePolicy,
                               com.lulu.campusmarketbackend.image.ImageService uploadedImages,
                               com.lulu.campusmarketbackend.image.ImageUrlSigner imageUrls) {
        this.imagePolicy = imagePolicy;
        this.uploadedImages = uploadedImages;
        this.imageUrls = imageUrls;
        this.supply = supply;
        this.validator = validator;
        this.rateLimit = rateLimit;
        this.json = json;
    }

    /** 当前请求者与草稿的关系。 */
    public enum Access { OWNER, ASSISTANT }

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, CREATE_FIELDS);
        String type = body.get("draftType") == null ? "SINGLE" : String.valueOf(body.get("draftType"));
        if (!Set.of("SINGLE", "BUNDLE").contains(type)) throw ApiException.badRequest("草稿类型无效");
        Map<String, Object> payload = normalizeImages(ListingPayload.sanitize(body.get("payload"), false), List.of());
        rateLimit.consume(RateLimitService.Scope.LISTING_DRAFT_CREATE, uid);
        UUID id = UUID.randomUUID();
        supply.insertDraft(id, UUID.fromString(uid), type, write(payload), expiry());
        return project(supply.selectDraft(id), Access.OWNER);
    }

    /** 本人的草稿（含已发布 / 已丢弃，便于找回）；读取时把到期的草稿显式标为 EXPIRED。 */
    @Transactional
    public List<Map<String, Object>> mine(String uid) {
        UUID owner = UUID.fromString(uid);
        supply.markOwnerExpired(owner);
        return projectAll(supply.selectDraftsByOwner(owner, 200), Access.OWNER);
    }

    /** 我作为协助人可以编辑的草稿（不含联系方式）。 */
    public List<Map<String, Object>> assisting(String uid) {
        return projectAll(supply.selectDraftsForAssistant(UUID.fromString(uid)), Access.ASSISTANT);
    }

    @Transactional
    public Map<String, Object> get(String uid, String id) {
        UUID draftId = parseId(id);
        Map<String, Object> row = supply.selectDraft(draftId);
        Access access = access(row, draftId, UUID.fromString(uid));
        if (supply.markExpired(draftId) > 0) row = supply.selectDraft(draftId);
        return project(row, access);
    }

    /**
     * 修改草稿。payload 整体替换（不做字段级合并，避免把两边的价格、描述悄悄拼在一起）；
     * status 只能在 DRAFT / READY 之间切换，进入 READY 前必须通过正式商品校验。
     * 协助人保存时保留所有者的联系方式，且不能把草稿标为 READY。
     */
    @Transactional
    public Map<String, Object> update(String uid, String id, Map<String, Object> body, String ifMatch) {
        JsonFieldPolicy.rejectUnknown(body, PATCH_FIELDS);
        UUID draftId = parseId(id);
        UUID me = UUID.fromString(uid);
        Map<String, Object> row = supply.selectDraft(draftId);
        Access access = access(row, draftId, me);
        int expected = expectedVersion(body.get("expectedVersion"), ifMatch);

        String status = DomainMapper.text(row.get("status"));
        if (supply.markExpired(draftId) > 0) throw ApiException.conflict("草稿已过期，不能再修改");
        if (!Set.of("DRAFT", "READY").contains(status)) throw ApiException.conflict("草稿已发布、已丢弃或已过期，不能再修改");

        // 客户端把 GET 拿到的签名地址原样提交回来时，先还原成 upload:<id>（库里只存引用）；
        // 外部地址开关关闭时，这份草稿原本就有的外部地址可以保留，新的外部地址 400
        Map<String, Object> payload = body.containsKey("payload")
                ? normalizeImages(ListingPayload.sanitize(body.get("payload"), access == Access.ASSISTANT), storedImages(row))
                : read(row.get("payload"));
        if (access == Access.ASSISTANT) {
            Map<String, Object> current = read(row.get("payload"));
            // 协助人只能整理白名单字段；成色、图片、验货声明、校区、教材版本等只能由所有者填写，必须原样保留
            Set<String> keys = new java.util.HashSet<>(payload.keySet());
            keys.addAll(current.keySet());
            for (String key : keys) {
                if (ListingPayload.ASSISTANT_FIELDS.contains(key) || ListingPayload.OWNER_ONLY_FIELDS.contains(key)) continue;
                if (!java.util.Objects.equals(json.valueToTree(payload.get(key)), json.valueToTree(current.get(key)))) {
                    throw ApiException.forbidden("协助人只能整理标题、描述、分类、价格建议、打包明细与取货楼栋建议");
                }
            }
            for (String key : ListingPayload.OWNER_ONLY_FIELDS) { if (current.containsKey(key)) payload.put(key, current.get(key)); }
        }
        String nextStatus = body.containsKey("status") ? String.valueOf(body.get("status")) : "DRAFT";
        if (!Set.of("DRAFT", "READY").contains(nextStatus)) throw ApiException.badRequest("草稿状态只能是 DRAFT 或 READY");
        if ("READY".equals(nextStatus)) {
            if (access == Access.ASSISTANT) throw ApiException.forbidden("只有商品所有者可以把草稿标记为可发布");
            ListingValidator.Result result = validator.validate(payload, DomainMapper.text(row.get("draft_type")),
                    validator.lookups((UUID) row.get("owner_user_id"), List.of(payload)));
            if (!result.valid()) throw new ApiException(400, "草稿还不能发布：" + result.message(), result.toMap());
        }
        if (supply.updateDraft(draftId, expected, me, write(payload), nextStatus, expiry()) == 0) {
            Map<String, Object> latest = supply.selectDraft(draftId);
            throw new ApiException(409, "草稿已被其他页面或协助人更新，请重新加载后再修改",
                    Map.of("currentVersion", latest == null ? 0 : ((Number) latest.get("version")).intValue()));
        }
        if (access == Access.ASSISTANT) {
            UUID inviteId = supply.selectAssistInviteFor(draftId, me);
            if (inviteId != null) supply.insertAssistEvent(inviteId, me, "ASSIST_DRAFT_EDITED", draftId);
        }
        return project(supply.selectDraft(draftId), access);
    }

    /** 丢弃是软状态，数据保留；仍在未发布批次里的草稿要先移出批次。幂等。 */
    @Transactional
    public Map<String, Object> discard(String uid, String id) {
        UUID draftId = parseId(id);
        UUID me = UUID.fromString(uid);
        Map<String, Object> row = supply.selectDraft(draftId);
        if (row == null || !me.equals(row.get("owner_user_id"))) throw ApiException.notFound("草稿不存在");
        if (row.get("batch_id") != null) throw ApiException.conflict("这个草稿还在批次里，请先从批次中移除");
        String status = DomainMapper.text(row.get("status"));
        if ("DISCARDED".equals(status)) return project(row, Access.OWNER);
        if (supply.discardDraft(draftId, me) == 0) throw ApiException.conflict("草稿已发布或已过期，不能丢弃");
        return project(supply.selectDraft(draftId), Access.OWNER);
    }

    // ------------------------------------------------------------------

    Access access(Map<String, Object> row, UUID draftId, UUID me) {
        if (row == null) throw ApiException.notFound("草稿不存在");
        if (me.equals(row.get("owner_user_id"))) return Access.OWNER;
        if (supply.countAssistantAccess(draftId, me) > 0) return Access.ASSISTANT;
        throw ApiException.notFound("草稿不存在");
    }

    /** 草稿投影。协助人看不到所有者的联系方式；任何人都看不到所有者 id 与编辑人 id。 */
    Map<String, Object> project(Map<String, Object> row, Access access) {
        return projectAll(List.of(row), access).get(0);
    }

    /**
     * 一组草稿的投影。图片与商品响应一样换成短时签名地址，但只给「草稿所有者本人上传、仍有效」的图片签名
     * （一条语句查完整组草稿的图片，与草稿数、图片数无关）；其余引用原样返回，保存时原样回写不会丢图。
     * 只在已经确认请求者是所有者或协助人之后调用。
     */
    List<Map<String, Object>> projectAll(List<Map<String, Object>> rows, Access access) {
        List<Map<String, Object>> payloads = rows.stream().map(r -> read(r.get("payload"))).toList();
        java.util.Set<UUID> ids = new java.util.HashSet<>();
        for (Map<String, Object> payload : payloads) {
            if (payload.get("images") instanceof List<?> images) {
                for (Object ref : images) { UUID id = com.lulu.campusmarketbackend.image.ImagePolicy.uploadId(ref); if (id != null) ids.add(id); }
            }
        }
        Map<UUID, UUID> owners = uploadedImages.activeOwners(ids);
        List<Map<String, Object>> result = new java.util.ArrayList<>();
        for (int i = 0; i < rows.size(); i++) result.add(project(rows.get(i), payloads.get(i), access, owners));
        return result;
    }

    private Map<String, Object> project(Map<String, Object> row, Map<String, Object> payload, Access access, Map<UUID, UUID> imageOwners) {
        if (access == Access.ASSISTANT) { payload.remove("contact"); payload.remove("contactPublic"); }
        if (payload.get("images") instanceof List<?> images) {
            Object owner = row.get("owner_user_id");
            payload.put("images", images.stream().map(ref -> {
                UUID id = com.lulu.campusmarketbackend.image.ImagePolicy.uploadId(ref);
                return id != null && owner != null && owner.equals(imageOwners.get(id)) ? imageUrls.publicUrl((String) ref) : ref;
            }).toList());
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("draftType", DomainMapper.text(row.get("draft_type")));
        result.put("status", DomainMapper.text(row.get("status")));
        result.put("version", ((Number) row.get("version")).intValue());
        result.put("payload", payload);
        result.put("access", access.name());
        result.put("editedByAssistant", !row.get("editor_user_id").equals(row.get("owner_user_id")));
        result.put("batchId", row.get("batch_id") == null ? null : DomainMapper.text(row.get("batch_id")));
        result.put("publishedProductId", row.get("published_product_id") == null ? null : DomainMapper.text(row.get("published_product_id")));
        result.put("expiresAt", DomainMapper.epoch(row.get("expires_at")));
        result.put("createdAt", DomainMapper.epoch(row.get("created_at")));
        result.put("updatedAt", DomainMapper.epoch(row.get("updated_at")));
        return result;
    }

    private Map<String, Object> normalizeImages(Map<String, Object> payload, List<String> keep) {
        if (payload.get("images") != null) payload.put("images", imagePolicy.draftImages(payload.get("images"), keep));
        return payload;
    }

    private List<String> storedImages(Map<String, Object> row) {
        Object images = read(row.get("payload")).get("images");
        if (!(images instanceof List<?> list)) return List.of();
        return list.stream().filter(String.class::isInstance).map(String.class::cast).toList();
    }

    Map<String, Object> read(Object raw) {
        if (raw == null) return new LinkedHashMap<>();
        try {
            return json.readValue(String.valueOf(raw), new TypeReference<LinkedHashMap<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("草稿内容格式错误", e);
        }
    }

    private String write(Map<String, Object> payload) {
        try {
            return json.writeValueAsString(payload);
        } catch (Exception e) {
            throw ApiException.badRequest("草稿内容格式无效");
        }
    }

    static OffsetDateTime expiry() {
        return OffsetDateTime.now(ZoneOffset.UTC).plusDays(EXPIRY_DAYS);
    }

    /** expectedVersion 来自请求体，或 If-Match 头（"3" 或 W/"3"）。两者都没有即 428 语义的 400。 */
    static int expectedVersion(Object raw, String ifMatch) {
        Object value = raw != null ? raw : ifMatch == null ? null : ifMatch.replace("W/", "").replace("\"", "").trim();
        if (value == null) throw ApiException.badRequest("请提供 expectedVersion 或 If-Match，防止覆盖其他页面的修改");
        try {
            int version = value instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(value));
            if (version < 1) throw new NumberFormatException();
            return version;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("expectedVersion 无效");
        }
    }

    static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("草稿不存在");
        }
    }
}
