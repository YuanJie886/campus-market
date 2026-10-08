package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.circle.CircleService;
import com.lulu.campusmarketbackend.mapper.FlowMapper;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 7.4：平台工作人员的案件处理与申诉。
 *
 * <ul>
 *   <li>工作人员只能看到与处理<b>本校</b>案件；他校案件与不存在同为 404；</li>
 *   <li>一个案件只有一个最终结果：结案时锁案件行并要求仍是 OPEN / UNDER_REVIEW；已由另一位工作人员领取的案件不能被他人结案；</li>
 *   <li>每个动作都写入只增不改的 moderation_actions（工作人员、原因码、说明、期限、是否实际生效）；</li>
 *   <li>强制归档圈子、超过 7 天的限制需要 SENIOR_MODERATOR；限制最长 30 天，没有永久限制；</li>
 *   <li>7.1C 利益回避由数据库函数 staff_case_conflict / staff_appeal_conflict 判断（{@link ConflictGuard}）：
 *       以本人为目标、本人的商品 / 评论 / 消息 / 圈子、本人参与的订单、本人提交的举报、本人做出的处理，
 *       本人都不能查看详情、领取、结案或决定申诉；这些案件不出现在本人的队列里。没有其他合适的工作人员时保持待处理；</li>
 *   <li>申诉成功撤销未到期的限制（爽约来源的同时推翻那次确认，并重算以它为依据的其他自动限制）、恢复商品 / 评论、解除私信隔离；</li>
 *   <li>目标摘要只有处理所需的最少字段：没有联系方式、确认码、账号、密码、Token 或会话全文；</li>
 *   <li>平台不做资金赔付，也不对商品真伪下结论——这里没有这类动作。</li>
 * </ul>
 */
@Service
public class StaffModerationService {

    public static final Set<String> ACTIONS = Set.of("HIDE_PRODUCT", "RESTORE_PRODUCT", "ARCHIVE_CIRCLE", "RESTRICT_BOOKING",
            "RESTRICT_PUBLISHING", "RESTRICT_CIRCLE_CREATION", "CONFIRM_NO_SHOW", "REJECT_NO_SHOW", "NO_ACTION",
            "HIDE_COMMENT", "RESTORE_COMMENT", "QUARANTINE_MESSAGE", "RELEASE_MESSAGE");
    public static final Set<String> DECISION_REASONS = Set.of("POLICY_VIOLATION", "PROHIBITED_ITEM", "HARASSMENT", "FRAUD_RISK",
            "CONFIRMED_NO_SHOW", "INSUFFICIENT_EVIDENCE", "DUPLICATE", "OTHER");
    private static final Set<String> CASE_STATUSES = Set.of("OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED", "APPEALED");
    private static final Set<String> DECISION_FIELDS = Set.of("action", "reasonCode", "note", "durationHours");
    private static final Set<String> OPEN_FIELDS = Set.of("targetType", "targetId");
    private static final Set<String> APPEAL_DECISION_FIELDS = Set.of("accept", "reasonCode", "note");
    private static final int MODERATOR_MAX_HOURS = 168;

    private final StaffGuard staffGuard;
    private final GovernanceMapper governance;
    private final RestrictionGuard restrictions;
    private final ModerationCases cases;
    private final CircleService circleService;
    private final ProductMapper products;
    private final FlowMapper flow;
    private final ConflictGuard conflicts;
    private final com.lulu.campusmarketbackend.mapper.UserMapper users;

    public StaffModerationService(StaffGuard staffGuard, GovernanceMapper governance, RestrictionGuard restrictions,
                                  ModerationCases cases, CircleService circleService, ProductMapper products, FlowMapper flow,
                                  ConflictGuard conflicts, com.lulu.campusmarketbackend.mapper.UserMapper users) {
        this.conflicts = conflicts;
        this.users = users;
        this.staffGuard = staffGuard;
        this.governance = governance;
        this.restrictions = restrictions;
        this.cases = cases;
        this.circleService = circleService;
        this.products = products;
        this.flow = flow;
    }

    // ================= 案件列表与详情 =================

    public Map<String, Object> list(String uid, Map<String, String> query) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        rejectUnknownQuery(query, Set.of("status", "targetType", "page", "size"));
        String status = blank(query.get("status")) ? null : NoShowService.code(query.get("status"), CASE_STATUSES, "案件状态");
        String type = blank(query.get("targetType")) ? null : NoShowService.code(query.get("targetType"), ModerationService.TARGETS, "目标类型");
        int page = pageParam(query.get("page"), "page", 10000, 1);
        int size = pageParam(query.get("size"), "size", 100, 20);
        List<Map<String, Object>> items = new ArrayList<>();
        // 与本人有利益冲突的案件不进入本人的队列（也不计入总数）
        for (Map<String, Object> c : governance.selectCases(staff.schoolId(), status, type, staff.userId(), size, (page - 1) * size)) items.add(summary(c, staff));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", governance.countCases(staff.schoolId(), status, type, staff.userId()));
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    public Map<String, Object> detail(String uid, String id) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        Map<String, Object> c = visibleCase(staff, id);
        conflicts.requireNoCaseConflict((UUID) c.get("id"), staff.userId());
        return detail(staff, c);
    }

    /** 工作人员主动立案（例如需要恢复一件此前被隐藏的商品）。目标必须存在于本校。 */
    @Transactional
    public Map<String, Object> open(String uid, Map<String, Object> body) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        JsonFieldPolicy.rejectUnknown(body, OPEN_FIELDS);
        String type = NoShowService.code(body.get("targetType"), ModerationService.TARGETS, "目标类型");
        UUID target = NoShowService.parse(String.valueOf(body.get("targetId")));
        Map<String, Object> summary = targetSummary(type, target);
        if (summary == null || !staff.schoolId().equals(summary.get("__school"))) throw ApiException.notFound("目标不存在");
        Map<String, Object> c = "NO_SHOW".equals(type) ? cases.ensureNoShowCase(staff.schoolId(), target)
                : cases.ensure(staff.schoolId(), type, target, null);
        // 利益冲突时整个事务回滚：本人不能为自己的内容立案并处理
        conflicts.requireNoCaseConflict((UUID) c.get("id"), staff.userId());
        return detail(staff, governance.selectCase((UUID) c.get("id")));
    }

    @Transactional
    public Map<String, Object> claim(String uid, String id) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        Map<String, Object> c = visibleCase(staff, id);
        UUID caseId = (UUID) c.get("id");
        conflicts.requireNoCaseConflict(caseId, staff.userId());
        c = governance.lockCase(caseId);
        String status = DomainMapper.text(c.get("status"));
        if ("UNDER_REVIEW".equals(status) && staff.userId().equals(c.get("assigned_staff_id"))) return detail(staff, c);
        if (!"OPEN".equals(status)) throw ApiException.conflict("案件已由其他工作人员处理或已结案");
        governance.claimCase(caseId, staff.userId());
        return detail(staff, governance.selectCase(caseId));
    }

    // ================= 结案（一个案件只有一个最终结果） =================

    @Transactional
    public Map<String, Object> decide(String uid, String id, Map<String, Object> body) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        // 顺序：先确认案件属于本校（他校与不存在同为 404），再确认还没有结果（409），最后才校验请求体
        Map<String, Object> probe = visibleCase(staff, id);
        conflicts.requireNoCaseConflict((UUID) probe.get("id"), staff.userId());
        if (!Set.of("OPEN", "UNDER_REVIEW").contains(DomainMapper.text(probe.get("status")))) throw ApiException.conflict("案件已经有处理结果");
        JsonFieldPolicy.rejectUnknown(body, DECISION_FIELDS);
        String action = NoShowService.code(body.get("action"), ACTIONS, "处理动作");
        String reason = NoShowService.code(body.get("reasonCode"), DECISION_REASONS, "处理原因");
        String note = ModerationService.noteOf(body.get("note"));
        if ("OTHER".equals(reason) && note == null) throw ApiException.badRequest("选择「其他」时请写一句说明");
        UUID caseId = (UUID) probe.get("id");
        String type = DomainMapper.text(probe.get("target_type"));
        UUID target = (UUID) probe.get("target_id");

        // 加锁顺序与爽约回应相同：订单 → 报告 → 案件，避免与「对方承认」互相死锁
        Map<String, Object> noShow = null;
        if ("NO_SHOW".equals(type)) {
            Map<String, Object> r = governance.selectNoShow(target);
            if (r != null) {
                flow.lockOrder((UUID) r.get("order_id"));
                noShow = governance.lockNoShow(target);
            }
        }
        Map<String, Object> c = governance.lockCase(caseId);
        String status = DomainMapper.text(c.get("status"));
        if (!Set.of("OPEN", "UNDER_REVIEW").contains(status)) throw ApiException.conflict("案件已经有处理结果");
        if ("UNDER_REVIEW".equals(status) && c.get("assigned_staff_id") != null && !staff.userId().equals(c.get("assigned_staff_id"))) {
            throw ApiException.conflict("案件已由其他工作人员领取");
        }
        Map<String, Object> summary = targetSummary(type, target);
        if (!allowedActions(type, staff, summary, noShow).contains(action)) throw ApiException.badRequest("这个动作不适用于该案件");

        UUID actionId = UUID.randomUUID();
        UUID restrictionId = null;
        OffsetDateTime expiresAt = null;
        boolean effective = true;
        String school = staff.schoolId();
        UUID subject = summary == null ? null : (UUID) summary.get("__subject");
        switch (action) {
            case "HIDE_PRODUCT", "RESTORE_PRODUCT" -> {
                Map<String, Object> p = products.selectForUpdate(target);
                boolean hidden = p.get("moderation_hidden_at") != null;
                effective = "HIDE_PRODUCT".equals(action) != hidden;
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, effective, subject);
                if (effective && "HIDE_PRODUCT".equals(action)) governance.hideProduct(target, actionId);
                if (effective && "RESTORE_PRODUCT".equals(action)) governance.restoreProduct(target, actionId);
            }
            case "HIDE_COMMENT", "RESTORE_COMMENT" -> {
                Map<String, Object> cm = governance.lockComment(target);
                effective = "HIDE_COMMENT".equals(action) != (cm.get("moderation_hidden_at") != null);
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, effective, subject);
                if (effective && "HIDE_COMMENT".equals(action)) governance.hideComment(target, actionId);
                if (effective && "RESTORE_COMMENT".equals(action)) governance.restoreComment(target, actionId);
            }
            case "QUARANTINE_MESSAGE", "RELEASE_MESSAGE" -> {
                Map<String, Object> msg = governance.lockMessage(target);
                effective = "QUARANTINE_MESSAGE".equals(action) != (msg.get("moderation_quarantined_at") != null);
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, effective, subject);
                if (effective && "QUARANTINE_MESSAGE".equals(action)) governance.quarantineMessage(target, actionId);
                if (effective && "RELEASE_MESSAGE".equals(action)) governance.releaseMessage(target, actionId);
            }
            case "RESTRICT_BOOKING", "RESTRICT_PUBLISHING", "RESTRICT_CIRCLE_CREATION" -> {
                int hours = duration(body.get("durationHours"), staff);
                restrictionId = restrictions.create(subject, school, action.substring("RESTRICT_".length()), "CASE", caseId, null,
                        staff.userId(), reason, hours);
                expiresAt = offset(governance.selectRestriction(restrictionId).get("ends_at"));
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, restrictionId, expiresAt, true, subject);
            }
            case "ARCHIVE_CIRCLE" -> {
                effective = circleService.archiveAsStaff(target, staff.userId());
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, effective, subject);
            }
            case "CONFIRM_NO_SHOW" -> {
                if (governance.decideNoShow(target, "CONFIRMED", staff.userId()) != 1) throw ApiException.conflict("爽约报告已经有结果");
                restrictionId = restrictions.applyNoShowRule((UUID) noShow.get("reported_user_id"), school, target, caseId, staff.userId());
                if (restrictionId != null) expiresAt = offset(governance.selectRestriction(restrictionId).get("ends_at"));
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, restrictionId, expiresAt, true, subject);
            }
            case "REJECT_NO_SHOW" -> {
                if (governance.decideNoShow(target, "REJECTED", staff.userId()) != 1) throw ApiException.conflict("爽约报告已经有结果");
                governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, true, subject);
            }
            default -> governance.insertAction(actionId, school, caseId, null, staff.userId(), action, reason, note, type, target, null, null, false, subject);
        }
        String finalStatus = Set.of("NO_ACTION", "REJECT_NO_SHOW").contains(action) ? "DISMISSED" : "RESOLVED";
        // 爽约确认的依据是接受时冻结的档期快照：没有快照的旧预约在 allowedActions 里就不提供 CONFIRM_NO_SHOW
        if (governance.resolveCase(caseId, finalStatus, action, staff.userId()) != 1) throw ApiException.conflict("案件已经有处理结果");
        return detail(staff, governance.selectCase(caseId));
    }

    private static OffsetDateTime offset(Object value) {
        return java.time.Instant.ofEpochMilli(DomainMapper.epoch(value)).atOffset(java.time.ZoneOffset.UTC);
    }

    private static int duration(Object raw, StaffGuard.Staff staff) {
        if (!(raw instanceof Number n) || n.doubleValue() != Math.floor(n.doubleValue())) {
            throw ApiException.badRequest("请填写限制时长（小时）");
        }
        int hours = n.intValue();
        if (hours < 1 || hours > 720) throw ApiException.badRequest("限制时长应为 1～720 小时（最长 30 天）");
        if (hours > MODERATOR_MAX_HOURS && !staff.senior()) throw ApiException.forbidden("超过 7 天的限制需要高级工作人员处理");
        return hours;
    }

    // ================= 申诉 =================

    public Map<String, Object> appeals(String uid, Map<String, String> query) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        rejectUnknownQuery(query, Set.of("status", "page", "size"));
        String status = blank(query.get("status")) ? null : NoShowService.code(query.get("status"), Set.of("PENDING", "ACCEPTED", "REJECTED"), "申诉状态");
        int page = pageParam(query.get("page"), "page", 10000, 1);
        int size = pageParam(query.get("size"), "size", 100, 20);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> a : governance.selectAppeals(staff.schoolId(), status, staff.userId(), size, (page - 1) * size)) items.add(appealView(a, staff));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", governance.countAppeals(staff.schoolId(), status, staff.userId()));
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    @Transactional
    public Map<String, Object> decideAppeal(String uid, String id, Map<String, Object> body) {
        StaffGuard.Staff staff = staffGuard.require(uid);
        JsonFieldPolicy.rejectUnknown(body, APPEAL_DECISION_FIELDS);
        if (!(body.get("accept") instanceof Boolean accept)) throw ApiException.badRequest("请选择接受或驳回");
        String reason = NoShowService.code(body.get("reasonCode"), Set.of("APPEAL_ACCEPTED", "APPEAL_REJECTED"), "处理原因");
        if (accept != "APPEAL_ACCEPTED".equals(reason)) throw ApiException.badRequest("处理原因与决定不一致");
        String note = ModerationService.noteOf(body.get("note"));
        UUID appealId = NoShowService.parse(id);
        Map<String, Object> appeal = governance.lockAppeal(appealId);
        if (appeal == null || !staff.schoolId().equals(appeal.get("school_id"))) throw ApiException.notFound("申诉不存在");
        if (!"PENDING".equals(appeal.get("status"))) throw ApiException.conflict("申诉已经有结果");
        // 7.1C：申诉人本人、原处理人、爽约报告人 / 订单双方、原案件的利益相关人都不能决定（数据库函数判断）
        conflicts.requireNoAppealConflict(appealId, staff.userId());
        // 固定加锁顺序：申诉 → 用户 → 限制 / 内容 → 报告。与「新建限制」「下单检查」在用户行上串行化，
        // 两条针对同一用户的申诉并发决定时也不会互相等待对方已锁的限制
        users.lockById((UUID) appeal.get("user_id"));
        UUID caseId = (UUID) appeal.get("case_id");
        UUID actionId = UUID.randomUUID();
        UUID appellant = (UUID) appeal.get("user_id");
        if (appeal.get("restriction_id") != null) {
            UUID restrictionId = (UUID) appeal.get("restriction_id");
            Map<String, Object> r = governance.lockRestriction(restrictionId);
            boolean effective = false;
            if (accept) {
                // 已自然到期的限制不需要撤销（撤销为 0 行），但申诉结论照常记录
                effective = governance.revokeRestriction(restrictionId, staff.userId(), "APPEAL_ACCEPTED") == 1;
                UUID report = (UUID) r.get("no_show_report_id");
                if (report != null && governance.overturnNoShow(report, staff.userId()) == 1) {
                    restrictions.recomputeAfterOverturn(report, appealId, staff.userId());
                }
            }
            governance.insertAction(actionId, staff.schoolId(), caseId, appealId, staff.userId(), accept ? "ACCEPT_APPEAL" : "REJECT_APPEAL",
                    reason, note, "RESTRICTION", restrictionId, restrictionId, null, effective, appellant);
        } else {
            UUID original = (UUID) appeal.get("action_id");
            Map<String, Object> act = governance.selectAction(original);
            String code = DomainMapper.text(act.get("action_code"));
            UUID target = (UUID) act.get("target_id");
            governance.insertAction(actionId, staff.schoolId(), caseId, appealId, staff.userId(), accept ? "ACCEPT_APPEAL" : "REJECT_APPEAL",
                    reason, note, "APPEAL", appealId, null, null, true, appellant);
            if (accept) undo(code, target, original, staff, caseId, appealId, reason, note, appellant);
        }
        governance.decideAppeal(appealId, accept ? "ACCEPTED" : "REJECTED", staff.userId());
        if (caseId != null) {
            governance.lockCase(caseId);
            governance.moveCase(caseId, "APPEALED", "RESOLVED");
        }
        return appealView(governance.selectAppeal(appealId), staff);
    }

    /** 申诉成功：撤回被申诉的处理，并追加一条对应的恢复动作（只增不改）。 */
    private void undo(String code, UUID target, UUID original, StaffGuard.Staff staff, UUID caseId, UUID appealId,
                      String reason, String note, UUID appellant) {
        UUID restore = UUID.randomUUID();
        switch (code) {
            case "HIDE_PRODUCT" -> {
                Map<String, Object> p = products.selectForUpdate(target);
                boolean still = p.get("moderation_hidden_at") != null && original.equals(p.get("moderation_hidden_action_id"));
                governance.insertAction(restore, staff.schoolId(), caseId, appealId, staff.userId(), "RESTORE_PRODUCT", reason, note,
                        "PRODUCT", target, null, null, still, appellant);
                if (still) governance.restoreProduct(target, restore);
            }
            case "HIDE_COMMENT" -> {
                Map<String, Object> cm = governance.lockComment(target);
                boolean still = cm.get("moderation_hidden_at") != null && original.equals(cm.get("moderation_hidden_action_id"));
                governance.insertAction(restore, staff.schoolId(), caseId, appealId, staff.userId(), "RESTORE_COMMENT", reason, note,
                        "COMMENT", target, null, null, still, appellant);
                if (still) governance.restoreComment(target, restore);
            }
            case "QUARANTINE_MESSAGE" -> {
                Map<String, Object> m = governance.lockMessage(target);
                boolean still = m.get("moderation_quarantined_at") != null && original.equals(m.get("moderation_quarantine_action_id"));
                governance.insertAction(restore, staff.schoolId(), caseId, appealId, staff.userId(), "RELEASE_MESSAGE", reason, note,
                        "MESSAGE", target, null, null, still, appellant);
                if (still) governance.releaseMessage(target, restore);
            }
            case "CONFIRM_NO_SHOW" -> {
                // 推翻这次确认：报告改为 REJECTED（不再计数），以它为依据的自动限制按规则重算（来源于它的直接撤销）
                if (governance.overturnNoShow(target, staff.userId()) == 1) {
                    restrictions.recomputeAfterOverturn(target, appealId, staff.userId());
                }
            }
            default -> throw new IllegalStateException("unsupported appeal action " + code);
        }
    }

    private Map<String, Object> appealView(Map<String, Object> a, StaffGuard.Staff staff) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", DomainMapper.text(a.get("id")));
        m.put("status", DomainMapper.text(a.get("status")));
        m.put("reason", DomainMapper.text(a.get("reason")));
        m.put("createdAt", DomainMapper.epoch(a.get("created_at")));
        m.put("decidedAt", a.get("decided_at") == null ? null : DomainMapper.epoch(a.get("decided_at")));
        Map<String, Object> subject = new LinkedHashMap<>();
        if (a.get("restriction_id") != null) {
            Map<String, Object> r = governance.selectRestriction((UUID) a.get("restriction_id"));
            subject.put("kind", "RESTRICTION");
            subject.put("scope", DomainMapper.text(r.get("scope")));
            subject.put("sourceType", DomainMapper.text(r.get("source")));
            subject.put("ruleVersion", DomainMapper.nullableText(r.get("rule_version")));
            subject.put("endsAt", DomainMapper.epoch(r.get("ends_at")));
            subject.put("active", r.get("revoked_at") == null && DomainMapper.epoch(r.get("ends_at")) > System.currentTimeMillis());
        } else {
            Map<String, Object> act = governance.selectAction((UUID) a.get("action_id"));
            subject.put("kind", "ACTION");
            subject.put("actionCode", DomainMapper.text(act.get("action_code")));
            subject.put("targetId", DomainMapper.text(act.get("target_id")));
        }
        m.put("subject", subject);
        m.put("caseId", a.get("case_id") == null ? null : DomainMapper.text(a.get("case_id")));
        m.put("decidable", "PENDING".equals(a.get("status")) && conflicts.appealConflict((UUID) a.get("id"), staff.userId()) == null);
        return m;
    }

    // ================= 投影 =================

    private Map<String, Object> visibleCase(StaffGuard.Staff staff, String id) {
        UUID caseId = NoShowService.parse(id);
        Map<String, Object> c = governance.selectCase(caseId);
        if (c == null || !staff.schoolId().equals(c.get("school_id"))) throw ApiException.notFound("案件不存在");
        return c;
    }

    private Map<String, Object> summary(Map<String, Object> c, StaffGuard.Staff staff) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", DomainMapper.text(c.get("id")));
        m.put("targetType", DomainMapper.text(c.get("target_type")));
        m.put("targetId", DomainMapper.text(c.get("target_id")));
        m.put("status", DomainMapper.text(c.get("status")));
        m.put("reportCount", ((Number) c.get("report_count")).intValue());
        m.put("createdAt", DomainMapper.epoch(c.get("created_at")));
        m.put("updatedAt", DomainMapper.epoch(c.get("updated_at")));
        m.put("assignedToMe", staff.userId().equals(c.get("assigned_staff_id")));
        m.put("assigned", c.get("assigned_staff_id") != null);
        m.put("resolutionCode", c.get("resolution_code") == null ? null : DomainMapper.text(c.get("resolution_code")));
        return m;
    }

    private Map<String, Object> detail(StaffGuard.Staff staff, Map<String, Object> c) {
        Map<String, Object> m = summary(c, staff);
        String type = DomainMapper.text(c.get("target_type"));
        UUID target = (UUID) c.get("target_id");
        Map<String, Object> raw = targetSummary(type, target);
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("type", type);
        t.put("exists", raw != null);
        t.put("label", raw == null ? "" : DomainMapper.text(raw.get("__label")));
        Map<String, Object> fields = new LinkedHashMap<>();
        if (raw != null) raw.forEach((k, v) -> { if (!k.startsWith("__")) fields.put(k, v); });
        t.put("fields", fields);
        m.put("target", t);
        List<Map<String, Object>> reports = new ArrayList<>();
        for (Map<String, Object> r : governance.selectCaseReports((UUID) c.get("id"))) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", DomainMapper.text(r.get("id")));
            x.put("reasonCode", DomainMapper.text(r.get("reason_code")));
            x.put("note", DomainMapper.nullableText(r.get("note")));
            x.put("snapshot", DomainMapper.nullableText(r.get("snapshot")));
            x.put("createdAt", DomainMapper.epoch(r.get("created_at")));
            reports.add(x);
        }
        m.put("reports", reports);
        List<Map<String, Object>> actions = new ArrayList<>();
        for (Map<String, Object> a : governance.selectCaseActions((UUID) c.get("id"))) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", DomainMapper.text(a.get("id")));
            x.put("actionCode", DomainMapper.text(a.get("action_code")));
            x.put("reasonCode", DomainMapper.text(a.get("reason_code")));
            x.put("note", DomainMapper.nullableText(a.get("note")));
            x.put("createdAt", DomainMapper.epoch(a.get("created_at")));
            x.put("byMe", staff.userId().equals(a.get("staff_user_id")));
            x.put("expiresAt", a.get("expires_at") == null ? null : DomainMapper.epoch(a.get("expires_at")));
            x.put("effective", Boolean.TRUE.equals(a.get("effective")));
            actions.add(x);
        }
        m.put("actions", actions);
        Map<String, Object> noShow = "NO_SHOW".equals(type) ? governance.selectNoShow(target) : null;
        m.put("noShow", noShow == null ? null : noShowDetail(noShow));
        String status = DomainMapper.text(c.get("status"));
        boolean decidable = Set.of("OPEN", "UNDER_REVIEW").contains(status)
                && (c.get("assigned_staff_id") == null || staff.userId().equals(c.get("assigned_staff_id")));
        m.put("allowedActions", decidable ? allowedActions(type, staff, raw, noShow) : List.of());
        return m;
    }

    /** 爽约复核：档期、报告与回应、双方的到达记录（本人手动声明，不是定位证据）。 */
    private Map<String, Object> noShowDetail(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("id", DomainMapper.text(r.get("id")));
        report.put("orderId", DomainMapper.text(r.get("order_id")));
        report.put("meetingRevision", ((Number) r.get("meeting_revision")).intValue());
        report.put("status", DomainMapper.text(r.get("status")));
        report.put("reasonCode", DomainMapper.text(r.get("reason_code")));
        report.put("note", DomainMapper.nullableText(r.get("note")));
        report.put("responseNote", DomainMapper.nullableText(r.get("response_note")));
        report.put("byMe", false);
        report.put("aboutMe", false);
        report.put("createdAt", DomainMapper.epoch(r.get("created_at")));
        report.put("respondedAt", r.get("responded_at") == null ? null : DomainMapper.epoch(r.get("responded_at")));
        report.put("decidedAt", r.get("decided_at") == null ? null : DomainMapper.epoch(r.get("decided_at")));
        report.put("canRespond", false);
        report.put("canEscalate", false);
        m.put("report", report);
        Map<String, Object> order = governance.selectOrderTarget((UUID) r.get("order_id"));
        int revision = ((Number) r.get("meeting_revision")).intValue();
        // 复核依据：报告所针对档期版本的快照（接受时冻结）；没有快照时 explicit=false，不补任何结束时间
        Map<String, Object> slot = governance.selectSlotAgreement((UUID) r.get("order_id"), revision);
        Map<String, Object> meeting = new LinkedHashMap<>();
        meeting.put("startsAt", slot == null ? DomainMapper.epoch(order.get("meeting_at")) : DomainMapper.epoch(slot.get("starts_at")));
        meeting.put("endsAt", slot == null ? null : DomainMapper.epoch(slot.get("ends_at")));
        meeting.put("revision", revision);
        meeting.put("explicit", slot != null);
        m.put("meeting", meeting);
        List<Map<String, Object>> presence = new ArrayList<>();
        for (Map<String, Object> p : governance.selectPresence((UUID) r.get("order_id"), revision)) {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("party", p.get("user_id").equals(r.get("reporter_user_id")) ? "REPORTER" : "REPORTED");
            x.put("status", DomainMapper.text(p.get("status")));
            Object at = p.get("arrived_at") != null ? p.get("arrived_at") : p.get("departed_at");
            x.put("at", at == null ? null : DomainMapper.epoch(at));
            presence.add(x);
        }
        m.put("presence", presence);
        return m;
    }

    /**
     * 目标摘要。键以 __ 开头的是内部字段（学校、被处理的用户、标签），不返回给前端。
     * 这里刻意不读取联系方式、确认码、账号或会话里的其他消息。
     */
    private Map<String, Object> targetSummary(String type, UUID target) {
        Map<String, Object> m = new LinkedHashMap<>();
        switch (type) {
            case "PRODUCT" -> {
                Map<String, Object> p = governance.selectProductTarget(target);
                if (p == null) return null;
                m.put("title", DomainMapper.text(p.get("title")));
                m.put("description", DomainMapper.text(p.get("description")));
                m.put("price", DomainMapper.decimal(p.get("price")).doubleValue());
                m.put("status", DomainMapper.text(p.get("status")));
                m.put("visibility", DomainMapper.text(p.get("visibility")));
                m.put("hidden", p.get("moderation_hidden_at") != null);
                m.put("sellerNickname", DomainMapper.text(p.get("seller_nickname")));
                m.put("__label", DomainMapper.text(p.get("title")));
                m.put("__school", p.get("school_id"));
                m.put("__subject", p.get("seller_id"));
                m.put("__hidden", p.get("moderation_hidden_at") != null);
            }
            case "USER" -> {
                Map<String, Object> u = governance.selectUserTarget(target);
                if (u == null) return null;
                m.put("nickname", DomainMapper.text(u.get("nickname")));
                m.put("campus", DomainMapper.text(u.get("campus")));
                m.put("joinedAt", DomainMapper.epoch(u.get("created_at")));
                m.put("__label", DomainMapper.text(u.get("nickname")));
                m.put("__school", u.get("school_id"));
                m.put("__subject", u.get("id"));
            }
            case "CIRCLE" -> {
                Map<String, Object> ci = governance.selectCircleTarget(target);
                if (ci == null) return null;
                m.put("name", DomainMapper.text(ci.get("name")));
                m.put("description", DomainMapper.text(ci.get("description")));
                m.put("type", DomainMapper.text(ci.get("type")));
                m.put("visibility", DomainMapper.text(ci.get("visibility")));
                m.put("status", DomainMapper.text(ci.get("status")));
                m.put("memberCount", ((Number) ci.get("member_count")).intValue());
                m.put("__label", DomainMapper.text(ci.get("name")));
                m.put("__school", ci.get("school_id"));
                m.put("__subject", ci.get("owner_user_id"));
                m.put("__archived", !"ACTIVE".equals(ci.get("status")));
            }
            case "COMMENT" -> {
                Map<String, Object> cm = governance.selectCommentTarget(target);
                if (cm == null) return null;
                m.put("content", DomainMapper.text(cm.get("content")));
                m.put("authorNickname", DomainMapper.text(cm.get("author_nickname")));
                m.put("createdAt", DomainMapper.epoch(cm.get("created_at")));
                m.put("hidden", cm.get("moderation_hidden_at") != null);
                m.put("__label", "留言");
                m.put("__school", cm.get("school_id"));
                m.put("__subject", cm.get("user_id"));
                m.put("__hidden", cm.get("moderation_hidden_at") != null);
            }
            case "MESSAGE" -> {
                Map<String, Object> msg = governance.selectMessageTarget(target);
                if (msg == null) return null;
                // 消息正文只以举报快照的形式出现在 reports 里，这里不再读取
                m.put("senderNickname", DomainMapper.text(msg.get("sender_nickname")));
                m.put("createdAt", DomainMapper.epoch(msg.get("created_at")));
                m.put("quarantined", msg.get("moderation_quarantined_at") != null);
                m.put("__label", "私信");
                m.put("__school", msg.get("school_id"));
                m.put("__subject", msg.get("sender_id"));
                m.put("__quarantined", msg.get("moderation_quarantined_at") != null);
            }
            case "ORDER" -> {
                Map<String, Object> o = governance.selectOrderTarget(target);
                if (o == null) return null;
                m.put("status", DomainMapper.text(o.get("status")));
                m.put("price", DomainMapper.decimal(o.get("price")).doubleValue());
                m.put("meetingAt", DomainMapper.epoch(o.get("meeting_at")));
                m.put("buyerNickname", DomainMapper.text(o.get("buyer_nickname")));
                m.put("sellerNickname", DomainMapper.text(o.get("seller_nickname")));
                m.put("__label", "订单");
                m.put("__school", o.get("school_id"));
            }
            default -> {
                Map<String, Object> r = governance.selectNoShow(target);
                if (r == null) return null;
                m.put("status", DomainMapper.text(r.get("status")));
                m.put("__label", "爽约复核");
                m.put("__school", r.get("school_id"));
                m.put("__subject", r.get("reported_user_id"));
                m.put("__explicitSlot", governance.selectSlotAgreement((UUID) r.get("order_id"), ((Number) r.get("meeting_revision")).intValue()) != null);
            }
        }
        return m;
    }

    private static List<String> allowedActions(String type, StaffGuard.Staff staff, Map<String, Object> summary, Map<String, Object> noShow) {
        List<String> a = new ArrayList<>();
        if (summary == null) {
            a.add("NO_ACTION");
            return a;
        }
        switch (type) {
            case "PRODUCT" -> {
                a.add(Boolean.TRUE.equals(summary.get("__hidden")) ? "RESTORE_PRODUCT" : "HIDE_PRODUCT");
                a.add("RESTRICT_PUBLISHING");
            }
            case "COMMENT", "MESSAGE" -> {
                if ("COMMENT".equals(type)) a.add(Boolean.TRUE.equals(summary.get("__hidden")) ? "RESTORE_COMMENT" : "HIDE_COMMENT");
                else a.add(Boolean.TRUE.equals(summary.get("__quarantined")) ? "RELEASE_MESSAGE" : "QUARANTINE_MESSAGE");
                a.add("RESTRICT_BOOKING");
                a.add("RESTRICT_PUBLISHING");
                a.add("RESTRICT_CIRCLE_CREATION");
            }
            case "USER" -> {
                a.add("RESTRICT_BOOKING");
                a.add("RESTRICT_PUBLISHING");
                a.add("RESTRICT_CIRCLE_CREATION");
            }
            case "CIRCLE" -> {
                if (staff.senior() && !Boolean.TRUE.equals(summary.get("__archived"))) a.add("ARCHIVE_CIRCLE");
                a.add("RESTRICT_CIRCLE_CREATION");
            }
            case "NO_SHOW" -> {
                if (noShow != null && Set.of("PENDING", "DISPUTED").contains(DomainMapper.text(noShow.get("status")))) {
                    // 7.1A：没有明确档期快照的旧预约只能驳回，不能确认为爽约
                    if (Boolean.TRUE.equals(summary.get("__explicitSlot"))) a.add("CONFIRM_NO_SHOW");
                    a.add("REJECT_NO_SHOW");
                    return a;
                }
            }
            default -> { }
        }
        a.add("NO_ACTION");
        return a;
    }

    private static void rejectUnknownQuery(Map<String, String> query, Set<String> allowed) {
        for (String k : query.keySet()) if (!allowed.contains(k)) throw ApiException.badRequest("不支持的字段：" + k);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static int pageParam(String raw, String name, int max, int fallback) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int n = Integer.parseInt(raw.trim());
            if (n < 1 || n > max) throw new NumberFormatException();
            return n;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(name + " 无效");
        }
    }
}
