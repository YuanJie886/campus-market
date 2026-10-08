package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.CircleMapper;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.school.SchoolScope;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 7.4：普通用户的举报、「我的举报」、「我的限制」与申诉。
 *
 * <ul>
 *   <li>只能举报自己能看到的目标；看不到的目标与不存在的目标是同一个 404——举报接口不能用来枚举私密圈子或商品；</li>
 *   <li>同一人对同一目标只保留一份举报（重复提交幂等返回原举报，不重复计入限流）；</li>
 *   <li>消息举报只保存那一条消息的内容作快照，不复制整段会话；</li>
 *   <li>举报人只看到状态摘要（已收到 / 处理中 / 已结束，是否采取了措施），看不到处理细节、工作人员或被举报人的处罚；</li>
 *   <li>被举报的人看不到举报人是谁；限制与隐藏只对本人可见，从不公开；</li>
 *   <li>每条限制 / 每次处理（商品隐藏、评论隐藏、私信隔离、工作人员确认的爽约）只能申诉一次；</li>
 *   <li>7.1C：本校暂时没有可以回避利益冲突的工作人员时，举报与申诉保持待处理并明确告知（不会被自动驳回）。</li>
 * </ul>
 */
@Service
public class ModerationService {

    public static final Set<String> TARGETS = Set.of("PRODUCT", "USER", "CIRCLE", "COMMENT", "MESSAGE", "ORDER", "NO_SHOW");
    public static final Set<String> REASONS = Set.of("PROHIBITED_ITEM", "MISLEADING", "FRAUD_SUSPECTED", "HARASSMENT", "SPAM",
            "IMPERSONATION", "NO_SHOW_REVIEW", "OTHER");
    private static final Set<String> REPORT_FIELDS = Set.of("targetType", "targetId", "reasonCode", "note");
    private static final Set<String> APPEAL_FIELDS = Set.of("restrictionId", "actionId", "reason");
    private static final String NOT_FOUND = "举报对象不存在或你没有权限查看";

    private final GovernanceMapper governance;
    private final CircleMapper circles;
    private final SchoolScope schools;
    private final ModerationCases cases;
    private final RateLimitService rateLimit;

    public ModerationService(GovernanceMapper governance, CircleMapper circles, SchoolScope schools, ModerationCases cases,
                             RateLimitService rateLimit) {
        this.governance = governance;
        this.circles = circles;
        this.schools = schools;
        this.cases = cases;
        this.rateLimit = rateLimit;
    }

    // ================= 举报 =================

    @Transactional
    public Map<String, Object> report(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, REPORT_FIELDS);
        UUID me = UUID.fromString(uid);
        String type = NoShowService.code(body.get("targetType"), TARGETS, "举报对象类型");
        String reason = NoShowService.code(body.get("reasonCode"), REASONS, "举报原因");
        String note = noteOf(body.get("note"));
        if ("OTHER".equals(reason) && note == null) throw ApiException.badRequest("选择「其他」时请写一句说明");
        if ("NO_SHOW".equals(type) != "NO_SHOW_REVIEW".equals(reason)) throw ApiException.badRequest("举报原因与对象不匹配");
        UUID target;
        try {
            target = UUID.fromString(String.valueOf(body.get("targetId")));
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound(NOT_FOUND);
        }
        String school = schools.schoolOf(uid);
        String snapshot = accessibleSnapshot(me, school, type, target);

        Map<String, Object> existing = governance.selectReport(me, type, target);
        if (existing != null) return mine(existing, governance.selectCase((UUID) existing.get("case_id")));
        rateLimit.consume(RateLimitService.Scope.MODERATION_REPORT, uid);
        Map<String, Object> c = "NO_SHOW".equals(type) ? cases.ensureNoShowCase(school, target) : cases.ensure(school, type, target, null);
        UUID id = UUID.randomUUID();
        if (governance.insertReport(id, school, (UUID) c.get("id"), me, type, target, reason, note, snapshot) == 1) {
            governance.bumpCase((UUID) c.get("id"));
        }
        Map<String, Object> saved = governance.selectReport(me, type, target);
        return mine(saved, governance.selectCase((UUID) saved.get("case_id")));
    }

    /**
     * 目标对举报人是否可见，并取出必要快照。不可见与不存在一律同一个 404（同一句话）。
     */
    private String accessibleSnapshot(UUID me, String school, String type, UUID target) {
        switch (type) {
            case "PRODUCT" -> {
                Map<String, Object> p = governance.selectProductTarget(target);
                if (p == null || !Boolean.TRUE.equals(circles.selectReadable(target, me))) throw ApiException.notFound(NOT_FOUND);
                if (me.equals(p.get("seller_id"))) throw ApiException.badRequest("不能举报自己发布的商品");
                return clip(DomainMapper.text(p.get("title")));
            }
            case "USER" -> {
                Map<String, Object> u = governance.selectUserTarget(target);
                if (u == null || !school.equals(u.get("school_id"))) throw ApiException.notFound(NOT_FOUND);
                if (me.equals(target)) throw ApiException.badRequest("不能举报自己");
                return clip(DomainMapper.text(u.get("nickname")));
            }
            case "CIRCLE" -> {
                Map<String, Object> ci = circles.selectCircle(target);
                if (ci == null || !school.equals(ci.get("school_id"))) throw ApiException.notFound(NOT_FOUND);
                Map<String, Object> m = circles.selectMembership(target, me);
                boolean member = m != null && "ACTIVE".equals(m.get("status"));
                boolean discoverable = "ACTIVE".equals(ci.get("status")) && "DISCOVERABLE".equals(ci.get("visibility"));
                if (!member && !discoverable) throw ApiException.notFound(NOT_FOUND);
                return clip(DomainMapper.text(ci.get("name")));
            }
            case "COMMENT" -> {
                Map<String, Object> cm = governance.selectCommentTarget(target);
                if (cm == null || !Boolean.TRUE.equals(circles.selectReadable((UUID) cm.get("product_id"), me))) throw ApiException.notFound(NOT_FOUND);
                if (me.equals(cm.get("user_id"))) throw ApiException.badRequest("不能举报自己的留言");
                return clip(DomainMapper.text(cm.get("content")));
            }
            case "MESSAGE" -> {
                Map<String, Object> msg = governance.selectMessageTarget(target);
                if (msg == null) throw ApiException.notFound(NOT_FOUND);
                boolean seller = me.equals(msg.get("seller_id"));
                boolean buyer = me.equals(msg.get("buyer_id"));
                if (!seller && !buyer) throw ApiException.notFound(NOT_FOUND);
                if (me.equals(msg.get("sender_id"))) throw ApiException.badRequest("不能举报自己发送的消息");
                return clip(DomainMapper.text(msg.get("content")));
            }
            case "ORDER" -> {
                Map<String, Object> o = governance.selectOrderTarget(target);
                if (o == null || (!me.equals(o.get("buyer_id")) && !me.equals(o.get("seller_id")))) throw ApiException.notFound(NOT_FOUND);
                return null;
            }
            default -> {
                // NO_SHOW：报告人请求工作人员复核自己提交的爽约报告
                Map<String, Object> r = governance.selectNoShow(target);
                if (r == null || !me.equals(r.get("reporter_user_id"))) throw ApiException.notFound(NOT_FOUND);
                if (!Set.of("PENDING", "DISPUTED").contains(DomainMapper.text(r.get("status")))) {
                    throw ApiException.conflict("这份爽约报告已经有结果，不需要再复核");
                }
                return null;
            }
        }
    }

    public List<Map<String, Object>> myReports(String uid) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : governance.selectMyReports(UUID.fromString(uid))) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("id", row.get("case_id"));
            c.put("status", row.get("case_status"));
            c.put("resolution_code", row.get("resolution_code"));
            result.add(mine(row, c));
        }
        return result;
    }

    /** 案件还没有结果、且本校没有一位可以回避利益冲突的在岗工作人员。 */
    private boolean awaitingEligibleStaff(Map<String, Object> c) {
        return c.get("id") instanceof UUID id && Set.of("OPEN", "UNDER_REVIEW").contains(DomainMapper.text(c.get("status")))
                && governance.eligibleStaffForCase(id) == 0;
    }

    /** 举报人自己看到的摘要：只有「已收到 / 处理中 / 已结束」与「是否采取了措施」。 */
    private Map<String, Object> mine(Map<String, Object> report, Map<String, Object> c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", DomainMapper.text(report.get("id")));
        m.put("targetType", DomainMapper.text(report.get("target_type")));
        m.put("targetId", DomainMapper.text(report.get("target_id")));
        m.put("reasonCode", DomainMapper.text(report.get("reason_code")));
        m.put("createdAt", DomainMapper.epoch(report.get("created_at")));
        String status = DomainMapper.text(c.get("status"));
        String resolution = c.get("resolution_code") == null ? null : DomainMapper.text(c.get("resolution_code"));
        // 申诉中的案件对举报人仍显示原来的结果：不透露被举报人是否申诉
        boolean closed = Set.of("RESOLVED", "DISMISSED", "APPEALED").contains(status);
        m.put("status", closed ? "CLOSED" : "OPEN".equals(status) ? "RECEIVED" : "UNDER_REVIEW");
        m.put("outcome", !closed ? null
                : resolution == null || Set.of("NO_ACTION", "REJECT_NO_SHOW").contains(resolution) ? "NO_ACTION" : "ACTION_TAKEN");
        m.put("awaitingEligibleStaff", !closed && awaitingEligibleStaff(c));
        return m;
    }

    // ================= 我的限制 =================

    public Map<String, Object> myGovernance(String uid) {
        UUID me = UUID.fromString(uid);
        List<Map<String, Object>> restrictions = new ArrayList<>();
        for (Map<String, Object> r : governance.selectMyRestrictions(me)) {
            Map<String, Object> m = new LinkedHashMap<>();
            boolean active = Boolean.TRUE.equals(r.get("active"));
            m.put("id", DomainMapper.text(r.get("id")));
            m.put("scope", DomainMapper.text(r.get("scope")));
            m.put("source", DomainMapper.text(r.get("source")));
            // 7.1B：自动限制的规则版本、决定时间、依据（确认时间）与纠正记录；只有本人看得到
            m.put("ruleVersion", DomainMapper.nullableText(r.get("rule_version")));
            m.put("decidedAt", DomainMapper.epoch(r.get("decided_at")));
            m.put("revokeReason", DomainMapper.nullableText(r.get("revoke_reason")));
            if ("SYSTEM_RULE".equals(r.get("source"))) {
                List<Map<String, Object>> basis = new ArrayList<>();
                for (Map<String, Object> b : governance.selectBasis((UUID) r.get("id"))) {
                    Map<String, Object> x = new LinkedHashMap<>();
                    x.put("confirmedAt", DomainMapper.epoch(b.get("confirmed_at")));
                    x.put("stillConfirmed", Set.of("ACKNOWLEDGED", "CONFIRMED").contains(DomainMapper.text(b.get("status"))));
                    basis.add(x);
                }
                m.put("basis", basis);
            } else {
                m.put("basis", List.of());
            }
            List<Map<String, Object>> corrections = new ArrayList<>();
            for (Map<String, Object> c : governance.selectCorrections((UUID) r.get("id"))) {
                Map<String, Object> x = new LinkedHashMap<>();
                x.put("outcome", DomainMapper.text(c.get("outcome")));
                x.put("remainingCount", ((Number) c.get("remaining_count")).intValue());
                x.put("previousEndsAt", DomainMapper.epoch(c.get("previous_ends_at")));
                x.put("newEndsAt", DomainMapper.epoch(c.get("new_ends_at")));
                x.put("createdAt", DomainMapper.epoch(c.get("created_at")));
                corrections.add(x);
            }
            m.put("corrections", corrections);
            m.put("reasonCode", DomainMapper.text(r.get("reason_code")));
            m.put("startsAt", DomainMapper.epoch(r.get("starts_at")));
            m.put("endsAt", DomainMapper.epoch(r.get("ends_at")));
            m.put("active", active);
            m.put("revokedAt", r.get("revoked_at") == null ? null : DomainMapper.epoch(r.get("revoked_at")));
            m.put("appeal", appeal(r));
            m.put("canAppeal", active && r.get("appeal_id") == null);
            restrictions.add(m);
        }
        List<Map<String, Object>> notices = new ArrayList<>();
        for (Map<String, Object> a : governance.selectMyActionNotices(me)) {
            Map<String, Object> m = new LinkedHashMap<>();
            boolean active = Boolean.TRUE.equals(a.get("active"));
            String code = DomainMapper.text(a.get("action_code"));
            m.put("actionId", DomainMapper.text(a.get("id")));
            m.put("actionCode", code);
            m.put("targetId", DomainMapper.text(a.get("target_id")));
            m.put("targetLabel", switch (code) {
                case "HIDE_PRODUCT" -> DomainMapper.text(a.get("title"));
                case "HIDE_COMMENT" -> "你的一条商品留言";
                case "QUARANTINE_MESSAGE" -> "你发送的一条私信";
                default -> "一次爽约确认";
            });
            m.put("reasonCode", DomainMapper.text(a.get("reason_code")));
            m.put("createdAt", DomainMapper.epoch(a.get("created_at")));
            m.put("active", active);
            m.put("appeal", appeal(a));
            m.put("canAppeal", active && a.get("appeal_id") == null);
            notices.add(m);
        }
        long confirmed = governance.countConfirmedNoShows(me);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("restrictions", restrictions);
        result.put("notices", notices);
        result.put("noShowWarning", confirmed == 0 ? null : Map.of("confirmedCount", confirmed, "windowDays", 30));
        return result;
    }

    private Map<String, Object> appeal(Map<String, Object> row) {
        if (row.get("appeal_id") == null) return null;
        Map<String, Object> a = new LinkedHashMap<>();
        String status = DomainMapper.text(row.get("appeal_status"));
        a.put("id", DomainMapper.text(row.get("appeal_id")));
        a.put("status", status);
        a.put("createdAt", DomainMapper.epoch(row.get("appeal_created_at")));
        a.put("decidedAt", row.get("appeal_decided_at") == null ? null : DomainMapper.epoch(row.get("appeal_decided_at")));
        // 7.1C：本校暂时没有可以回避的工作人员 → 保持待处理，明确告知，不会被自动驳回
        a.put("awaitingEligibleStaff", "PENDING".equals(status) && governance.eligibleStaffForAppeal((UUID) row.get("appeal_id")) == 0);
        return a;
    }

    // ================= 申诉 =================

    @Transactional
    public Map<String, Object> appeal(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, APPEAL_FIELDS);
        UUID me = UUID.fromString(uid);
        Object reasonRaw = body.get("reason");
        if (!(reasonRaw instanceof String rs) || rs.isBlank()) throw ApiException.badRequest("请写明申诉理由");
        String reason = rs.trim();
        if (reason.length() > 500 || reason.matches("(?s).*[<>].*")) throw ApiException.badRequest("申诉理由最多 500 字，且不能包含尖括号");
        boolean byRestriction = body.get("restrictionId") != null;
        if (byRestriction == (body.get("actionId") != null)) throw ApiException.badRequest("请指定要申诉的一条限制或一次处理");
        UUID restrictionId = null, actionId = null, caseId;
        String school;
        if (byRestriction) {
            restrictionId = NoShowService.parse(String.valueOf(body.get("restrictionId")));
            Map<String, Object> r = governance.lockRestriction(restrictionId);
            if (r == null || !me.equals(r.get("user_id"))) throw ApiException.notFound("限制不存在");
            if (r.get("revoked_at") != null || DomainMapper.epoch(r.get("ends_at")) <= System.currentTimeMillis()) {
                throw ApiException.conflict("这条限制已经结束，不需要申诉");
            }
            caseId = (UUID) r.get("case_id");
            school = DomainMapper.text(r.get("school_id"));
        } else {
            actionId = NoShowService.parse(String.valueOf(body.get("actionId")));
            Map<String, Object> a = governance.selectAction(actionId);
            // 只能申诉与本人有关、仍在生效的处理：同一条「我的限制」查询给出 active，口径一致
            Map<String, Object> notice = null;
            if (a != null && me.equals(a.get("subject_user_id"))) {
                for (Map<String, Object> n : governance.selectMyActionNotices(me)) if (actionId.equals(n.get("id"))) notice = n;
            }
            if (notice == null) throw ApiException.notFound("处理记录不存在");
            if (!Boolean.TRUE.equals(notice.get("active"))) throw ApiException.conflict("这项处理已经不再生效，不需要申诉");
            caseId = (UUID) a.get("case_id");
            school = DomainMapper.text(a.get("school_id"));
        }
        rateLimit.consume(RateLimitService.Scope.APPEAL_SUBMIT, uid);
        UUID id = UUID.randomUUID();
        if (governance.insertAppeal(id, school, me, restrictionId, actionId, caseId, reason) == 0) {
            throw ApiException.conflict("每条限制或处理只能申诉一次");
        }
        if (caseId != null) {
            governance.lockCase(caseId);
            governance.moveCase(caseId, "RESOLVED", "APPEALED");
        }
        Map<String, Object> saved = governance.selectAppeal(id);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id.toString());
        m.put("status", DomainMapper.text(saved.get("status")));
        m.put("createdAt", DomainMapper.epoch(saved.get("created_at")));
        m.put("decidedAt", null);
        return m;
    }

    static String noteOf(Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof String s)) throw ApiException.badRequest("说明格式无效");
        String value = s.trim();
        if (value.isEmpty()) return null;
        if (value.length() > 500 || value.matches("(?s).*[<>].*")) throw ApiException.badRequest("说明最多 500 字，且不能包含尖括号");
        return value;
    }

    private static String clip(String text) {
        return text.length() > 2000 ? text.substring(0, 2000) : text;
    }
}
