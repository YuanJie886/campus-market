package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.SupplyMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 协助整理发布（5.1D / 5.5）。
 *
 * <p>所有者为某个草稿或批次创建一次性邀请；服务端只保存邀请码的 SHA-256，原始邀请码只在创建响应里出现一次，
 * 不写日志、不进 URL query（前端用手动输入或 URL fragment，只在兑换请求体里提交）。
 * 登录用户兑换后成为协助人，只能编辑被授权的草稿（不含联系方式），不能发布、不能创建二次邀请、
 * 不能读取订单、确认码、交易履历或所有者的其他草稿——这些接口的权限判断本来就只认所有者或订单双方。
 * 所有者可以随时撤销；撤销或过期后，协助人下一次写入立即 404。
 */
@Service
public class AssistInviteService {

    public static final int DEFAULT_HOURS = 24;
    public static final int MAX_HOURS = 7 * 24;
    private static final Set<String> CREATE_FIELDS = Set.of("draftId", "batchId", "expiresInHours");
    private static final Set<String> REDEEM_FIELDS = Set.of("token");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SupplyMapper supply;
    private final RateLimitService rateLimit;
    private final ListingDraftService drafts;

    public AssistInviteService(SupplyMapper supply, RateLimitService rateLimit, ListingDraftService drafts) {
        this.supply = supply;
        this.rateLimit = rateLimit;
        this.drafts = drafts;
    }

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, CREATE_FIELDS);
        UUID owner = UUID.fromString(uid);
        UUID draftId = body.get("draftId") == null ? null : ListingDraftService.parseId(String.valueOf(body.get("draftId")));
        UUID batchId = body.get("batchId") == null ? null : ListingDraftService.parseId(String.valueOf(body.get("batchId")));
        if ((draftId == null) == (batchId == null)) throw ApiException.badRequest("请指定一个草稿或一个批次");
        int hours = DEFAULT_HOURS;
        if (body.get("expiresInHours") != null) {
            if (!(body.get("expiresInHours") instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())
                    || n.intValue() < 1 || n.intValue() > MAX_HOURS) {
                throw ApiException.badRequest("有效期应为 1～168 小时");
            }
            hours = n.intValue();
        }
        // 只能为自己名下、仍可编辑的草稿或批次邀请；协助人（不是所有者）在这里得到 404
        if (draftId != null) {
            Map<String, Object> draft = supply.selectDraft(draftId);
            if (draft == null || !owner.equals(draft.get("owner_user_id"))) throw ApiException.notFound("草稿不存在");
            if (!Set.of("DRAFT", "READY").contains(DomainMapper.text(draft.get("status")))) throw ApiException.conflict("草稿已不可编辑");
        } else {
            Map<String, Object> batch = supply.selectBatch(batchId);
            if (batch == null || !owner.equals(batch.get("owner_user_id"))) throw ApiException.notFound("批次不存在");
            if (!"OPEN".equals(batch.get("status"))) throw ApiException.conflict("批次已发布或已丢弃");
        }
        rateLimit.consume(RateLimitService.Scope.ASSIST_INVITE_CREATE, uid);

        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UUID id = UUID.randomUUID();
        supply.insertInvite(id, owner, draftId, batchId, ListingBatchService.sha256(token), hours);
        supply.insertAssistEvent(id, owner, "INVITE_CREATED", draftId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("invite", mine(uid).stream().filter(i -> id.toString().equals(i.get("id"))).findFirst().orElseThrow());
        // 原始邀请码只出现这一次；服务端不保存、不能再次取回
        result.put("token", token);
        return result;
    }

    /** 本人创建的邀请（不含邀请码）。 */
    public List<Map<String, Object>> mine(String uid) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : supply.selectInvitesByOwner(UUID.fromString(uid))) result.add(project(row));
        return result;
    }

    /**
     * 兑换邀请。每一次尝试都先计入限流（成功或失败）；失败的原因——不存在、已兑换、已撤销、已过期、
     * 自己兑换自己的邀请——对外一律同一个 404，不泄露这个邀请码是否曾经存在。
     */
    @Transactional
    public Map<String, Object> redeem(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, REDEEM_FIELDS);
        rateLimit.consume(RateLimitService.Scope.ASSIST_INVITE_REDEEM, uid);
        UUID me = UUID.fromString(uid);
        Object raw = body.get("token");
        if (!(raw instanceof String token) || token.isBlank() || token.length() > 200) throw invalid();
        Map<String, Object> invite = supply.lockInviteByHash(ListingBatchService.sha256(token.trim()));
        if (invite == null || me.equals(invite.get("owner_user_id")) || !"PENDING".equals(invite.get("status"))) throw invalid();
        UUID id = (UUID) invite.get("id");
        if (supply.activateInvite(id, me) == 0) throw invalid();
        supply.insertAssistEvent(id, me, "INVITE_REDEEMED", (UUID) invite.get("draft_id"));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("inviteId", id.toString());
        result.put("drafts", drafts.assisting(uid));
        return result;
    }

    /** 撤销，幂等。之后协助人的读写立即失效。 */
    @Transactional
    public Map<String, Object> revoke(String uid, String id) {
        UUID owner = UUID.fromString(uid);
        UUID inviteId = ListingDraftService.parseId(id);
        Map<String, Object> invite = supply.selectOwnInvite(inviteId, owner);
        if (invite == null) throw ApiException.notFound("邀请不存在");
        if (supply.revokeInvite(inviteId, owner) > 0) supply.insertAssistEvent(inviteId, owner, "INVITE_REVOKED", (UUID) invite.get("draft_id"));
        return mine(uid).stream().filter(i -> id.equals(i.get("id"))).findFirst().orElseThrow();
    }

    /** 审计事件：只有所有者可读；只有机器码与时间，不含邀请码或草稿内容。 */
    public List<Map<String, Object>> events(String uid, String id) {
        UUID owner = UUID.fromString(uid);
        UUID inviteId = ListingDraftService.parseId(id);
        if (supply.selectOwnInvite(inviteId, owner) == null) throw ApiException.notFound("邀请不存在");
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : supply.selectAssistEvents(inviteId, owner)) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("code", DomainMapper.text(row.get("event_code")));
            e.put("byOwner", Boolean.TRUE.equals(row.get("by_owner")));
            e.put("draftId", row.get("draft_id") == null ? null : DomainMapper.text(row.get("draft_id")));
            e.put("at", DomainMapper.epoch(row.get("created_at")));
            result.add(e);
        }
        return result;
    }

    private static ApiException invalid() {
        return ApiException.notFound("邀请码无效或已失效");
    }

    private static Map<String, Object> project(Map<String, Object> row) {
        String status = DomainMapper.text(row.get("status"));
        boolean expired = !"REVOKED".equals(status) && DomainMapper.epoch(row.get("expires_at")) <= System.currentTimeMillis();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("scope", row.get("draft_id") != null ? "DRAFT" : "BATCH");
        result.put("draftId", row.get("draft_id") == null ? null : DomainMapper.text(row.get("draft_id")));
        result.put("batchId", row.get("batch_id") == null ? null : DomainMapper.text(row.get("batch_id")));
        result.put("status", expired ? "EXPIRED" : status);
        result.put("assistantNickname", row.get("assistant_nickname") == null ? null : DomainMapper.text(row.get("assistant_nickname")));
        result.put("expiresAt", DomainMapper.epoch(row.get("expires_at")));
        result.put("createdAt", DomainMapper.epoch(row.get("created_at")));
        return result;
    }
}
