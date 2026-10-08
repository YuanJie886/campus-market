package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.SupplyMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 批量发布（5.1B / 5.2）。
 *
 * <ul>
 *   <li>一个批次最多 20 条，一条对应一个草稿；同一草稿不能同时在两个未发布批次里（部分唯一索引）。</li>
 *   <li>发布全有或全无：所有商品与它们的需求匹配在<b>同一个事务</b>里写入，任一条失败整体回滚。</li>
 *   <li>整体幂等：Idempotency-Key 相同且请求相同 → 返回原结果；相同键、不同请求 → 409；
 *       并发请求在所有者的行锁上串行化，重试不会重复创建商品或需求匹配。</li>
 *   <li>只有所有者能发布；协助人对发布接口一律 404。</li>
 *   <li>响应只有新商品 id，不返回命中的需求人数或订阅信息：卖家不能借此试探市场需求。</li>
 * </ul>
 */
@Service
public class ListingBatchService {

    public static final int MAX_ITEMS = 20;
    private static final Set<String> CREATE_FIELDS = Set.of("draftIds");
    private static final Set<String> PATCH_FIELDS = Set.of("expectedVersion", "draftIds");

    private final SupplyMapper supply;
    private final UserMapper users;
    private final ListingValidator validator;
    private final ListingDraftService drafts;
    private final MarketService market;
    private final RateLimitService rateLimit;

    private final com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions;

    public ListingBatchService(SupplyMapper supply, UserMapper users, ListingValidator validator,
                               ListingDraftService drafts, MarketService market, RateLimitService rateLimit,
                               com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions) {
        this.restrictions = restrictions;
        this.supply = supply;
        this.users = users;
        this.validator = validator;
        this.drafts = drafts;
        this.market = market;
        this.rateLimit = rateLimit;
    }

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, CREATE_FIELDS);
        UUID owner = UUID.fromString(uid);
        List<UUID> draftIds = draftIds(body.get("draftIds"));
        UUID id = UUID.randomUUID();
        supply.insertBatch(id, owner);
        attach(id, owner, draftIds);
        return detail(uid, id.toString());
    }

    public List<Map<String, Object>> mine(String uid) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : supply.selectBatchesByOwner(UUID.fromString(uid))) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", DomainMapper.text(row.get("id")));
            item.put("status", DomainMapper.text(row.get("status")));
            item.put("version", ((Number) row.get("version")).intValue());
            item.put("itemCount", ((Number) row.get("item_count")).intValue());
            item.put("createdAt", DomainMapper.epoch(row.get("created_at")));
            item.put("publishedAt", row.get("published_at") == null ? null : DomainMapper.epoch(row.get("published_at")));
            result.add(item);
        }
        return result;
    }

    /** 批次详情与逐项校验结果。读取语句数与条目数无关（草稿一次取回、参考数据一次预读）。 */
    public Map<String, Object> detail(String uid, String id) {
        UUID batchId = ListingDraftService.parseId(id);
        Map<String, Object> batch = supply.selectBatch(batchId);
        if (batch == null || !UUID.fromString(uid).equals(batch.get("owner_user_id"))) throw ApiException.notFound("批次不存在");
        List<Map<String, Object>> rows = supply.selectBatchItems(batchId);
        boolean open = "OPEN".equals(batch.get("status"));
        List<Map<String, Object>> payloads = rows.stream().map(r -> drafts.read(r.get("payload"))).toList();
        ListingValidator.Lookups lookups = open && !rows.isEmpty() ? validator.lookups((UUID) batch.get("owner_user_id"), payloads) : null;
        List<Map<String, Object>> items = new ArrayList<>();
        boolean allValid = !rows.isEmpty();
        boolean assisted = false;
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> row = rows.get(i);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("position", ((Number) row.get("position")).intValue());
            Map<String, Object> draft = drafts.project(row, ListingDraftService.Access.OWNER);
            item.put("draft", draft);
            assisted |= Boolean.TRUE.equals(draft.get("editedByAssistant"));
            item.put("productId", row.get("item_product_id") == null ? null : DomainMapper.text(row.get("item_product_id")));
            if (open) {
                ListingValidator.Result result = statusProblem(row);
                if (result == null) result = validator.validate(payloads.get(i), DomainMapper.text(row.get("draft_type")), lookups);
                allValid &= result.valid();
                item.put("validation", result.toMap());
            }
            items.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(batch.get("id")));
        result.put("status", DomainMapper.text(batch.get("status")));
        result.put("version", ((Number) batch.get("version")).intValue());
        result.put("items", items);
        result.put("allValid", open && allValid);
        // 有协助人参与整理时，发布页必须如实标明
        result.put("assisted", assisted);
        result.put("createdAt", DomainMapper.epoch(batch.get("created_at")));
        result.put("publishedAt", batch.get("published_at") == null ? null : DomainMapper.epoch(batch.get("published_at")));
        return result;
    }

    /** 整体替换批次条目（顺序即发布顺序）。乐观锁保护。 */
    @Transactional
    public Map<String, Object> update(String uid, String id, Map<String, Object> body, String ifMatch) {
        JsonFieldPolicy.rejectUnknown(body, PATCH_FIELDS);
        UUID owner = UUID.fromString(uid);
        UUID batchId = ListingDraftService.parseId(id);
        Map<String, Object> batch = supply.lockBatch(batchId);
        if (batch == null || !owner.equals(batch.get("owner_user_id"))) throw ApiException.notFound("批次不存在");
        if (!"OPEN".equals(batch.get("status"))) throw ApiException.conflict("批次已发布或已丢弃，不能再修改");
        int expected = ListingDraftService.expectedVersion(body.get("expectedVersion"), ifMatch);
        if (supply.bumpBatch(batchId, expected) == 0) throw ApiException.conflict("批次已被其他页面更新，请重新加载");
        List<UUID> draftIds = draftIds(body.get("draftIds"));
        supply.deleteBatchItems(batchId);
        attach(batchId, owner, draftIds);
        return detail(uid, id);
    }

    /**
     * 发布整个批次。
     *
     * <p>步骤：限流 → 所有者行锁（串行化同一所有者的并发发布） → 幂等检查 → 批次行锁 →
     * 草稿行锁 → 逐项校验（任一不通过：400，逐项结果放在 data，什么都不写） →
     * 按顺序逐条发布（MarketService.createProductAs：商品 + 验货声明 / 打包明细 + 教材关联 + 需求匹配） →
     * 草稿、批次、幂等记录落库。任一步抛出异常，整个事务回滚。
     */
    @Transactional
    public Map<String, Object> publish(String uid, String id, String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank() || idempotencyKey.length() < 8 || idempotencyKey.length() > 100) {
            throw ApiException.badRequest("请提供 8～100 位的 Idempotency-Key");
        }
        UUID owner = UUID.fromString(uid);
        UUID batchId = ListingDraftService.parseId(id);
        rateLimit.consume(RateLimitService.Scope.LISTING_BATCH_PUBLISH, uid);
        users.lockById(owner);

        String hash = sha256("listing-batch-publish\nbatch=" + batchId);
        Map<String, Object> previous = supply.selectPublishRequest(owner, idempotencyKey);
        if (previous != null) {
            if (!hash.equals(previous.get("request_hash"))) throw ApiException.conflict("这个 Idempotency-Key 已用于另一次发布");
            return result(DomainMapper.text(previous.get("batch_id")), textArray(previous.get("product_ids")), true);
        }
        // 模块 7：发布受限时整批不发布（保存草稿不受影响）；同键重放上面已经原样返回
        restrictions.require(owner, "PUBLISHING");

        Map<String, Object> batch = supply.lockBatch(batchId);
        if (batch == null || !owner.equals(batch.get("owner_user_id"))) throw ApiException.notFound("批次不存在");
        if (!"OPEN".equals(batch.get("status"))) throw ApiException.conflict("批次已发布或已丢弃");
        List<Map<String, Object>> rows = supply.selectBatchItems(batchId);
        if (rows.isEmpty()) throw ApiException.badRequest("批次里还没有商品");
        List<UUID> ids = rows.stream().map(r -> (UUID) r.get("id")).toList();
        supply.lockDrafts(ids);
        rows = supply.selectBatchItems(batchId);

        List<Map<String, Object>> payloads = rows.stream().map(r -> drafts.read(r.get("payload"))).toList();
        ListingValidator.Lookups lookups = validator.lookups(owner, payloads);
        List<Map<String, Object>> problems = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            ListingValidator.Result r = statusProblem(rows.get(i));
            if (r == null) r = validator.validate(payloads.get(i), DomainMapper.text(rows.get(i).get("draft_type")), lookups);
            if (!r.valid()) {
                Map<String, Object> p = new LinkedHashMap<>(r.toMap());
                p.put("position", ((Number) rows.get(i).get("position")).intValue());
                p.put("draftId", DomainMapper.text(rows.get(i).get("id")));
                problems.add(p);
            }
        }
        if (!problems.isEmpty()) {
            throw new ApiException(400, "有 " + problems.size() + " 件商品还不能发布，整个批次都没有发布", Map.of("items", problems));
        }

        Map<UUID, UUID> assistedBy = new HashMap<>();
        Set<UUID> assistInvites = new LinkedHashSet<>();
        for (Map<String, Object> e : supply.selectLastAssistEditors(ids)) {
            assistedBy.put((UUID) e.get("draft_id"), (UUID) e.get("actor_user_id"));
            assistInvites.add((UUID) e.get("invite_id"));
        }
        List<String> productIds = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> row = rows.get(i);
            UUID draftId = (UUID) row.get("id");
            Map<String, Object> body = new LinkedHashMap<>(payloads.get(i));
            body.put("listingKind", DomainMapper.text(row.get("draft_type")));
            Map<String, Object> product = market.createProductAs(owner, body, owner, assistedBy.get(draftId));
            UUID productId = UUID.fromString(String.valueOf(product.get("id")));
            if (supply.markDraftPublished(draftId, productId) == 0) throw ApiException.conflict("草稿状态已变化，请重新加载");
            supply.setBatchItemProduct(batchId, draftId, productId);
            productIds.add(productId.toString());
        }
        supply.markBatchPublished(batchId);
        supply.deactivateBatchItems(batchId);
        supply.insertPublishRequest(owner, idempotencyKey, hash, batchId, productIds.toArray(String[]::new));
        for (UUID invite : assistInvites) supply.insertAssistEvent(invite, owner, "PUBLISHED_AFTER_ASSIST", null);
        return result(batchId.toString(), productIds, false);
    }

    @Transactional
    public Map<String, Object> discard(String uid, String id) {
        UUID owner = UUID.fromString(uid);
        UUID batchId = ListingDraftService.parseId(id);
        Map<String, Object> batch = supply.lockBatch(batchId);
        if (batch == null || !owner.equals(batch.get("owner_user_id"))) throw ApiException.notFound("批次不存在");
        if ("OPEN".equals(batch.get("status"))) {
            supply.discardBatch(batchId, owner);
            supply.deactivateBatchItems(batchId);
        }
        return detail(uid, id);
    }

    // ------------------------------------------------------------------

    private void attach(UUID batchId, UUID owner, List<UUID> draftIds) {
        if (draftIds.isEmpty()) return;
        for (UUID draftId : draftIds) {
            Map<String, Object> draft = supply.selectDraft(draftId);
            if (draft == null || !owner.equals(draft.get("owner_user_id"))) throw ApiException.notFound("草稿不存在");
            if (!Set.of("DRAFT", "READY").contains(DomainMapper.text(draft.get("status")))) {
                throw ApiException.conflict("只能把未发布、未丢弃、未过期的草稿加入批次");
            }
        }
        try {
            supply.insertBatchItems(batchId, owner, draftIds);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("有草稿已经在另一个未发布的批次里");
        }
    }

    private static List<UUID> draftIds(Object raw) {
        if (raw == null) return List.of();
        if (!(raw instanceof List<?> list)) throw ApiException.badRequest("draftIds 格式无效");
        if (list.size() > MAX_ITEMS) throw ApiException.badRequest("一个批次最多 " + MAX_ITEMS + " 件商品");
        Set<UUID> ids = new LinkedHashSet<>();
        for (Object v : list) {
            UUID id = ListingDraftService.parseId(String.valueOf(v));
            if (!ids.add(id)) throw ApiException.badRequest("同一个草稿不能在批次里出现两次");
        }
        return List.copyOf(ids);
    }

    /** 草稿本身已不可发布（已发布 / 丢弃 / 过期）时的原因。 */
    private static ListingValidator.Result statusProblem(Map<String, Object> row) {
        String status = DomainMapper.text(row.get("status"));
        boolean expired = row.get("expires_at") != null
                && DomainMapper.epoch(row.get("expires_at")) <= System.currentTimeMillis();
        if (!Set.of("DRAFT", "READY").contains(status) || expired) {
            return new ListingValidator.Result("DRAFT_CLOSED", "status", "草稿已发布、已丢弃或已过期");
        }
        return null;
    }

    private static Map<String, Object> result(String batchId, List<String> productIds, boolean replayed) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("batchId", batchId);
        result.put("productIds", productIds);
        result.put("publishedCount", productIds.size());
        result.put("replayed", replayed);
        return result;
    }

    private static List<String> textArray(Object raw) {
        try {
            if (raw instanceof java.sql.Array array) {
                Object[] values = (Object[]) array.getArray();
                List<String> result = new ArrayList<>();
                for (Object v : values) result.add(String.valueOf(v));
                return result;
            }
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
        }
        if (raw instanceof String[] values) return List.of(values);
        return List.of();
    }

    static String sha256(String text) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
