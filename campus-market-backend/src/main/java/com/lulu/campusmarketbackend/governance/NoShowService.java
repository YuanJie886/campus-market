package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.FlowMapper;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.OrderTransitionExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 7.2：爽约报告。
 *
 * <ul>
 *   <li>必须存在双方确认过、<b>有明确开始与结束时间</b>的档期快照（order_slot_agreements：卖家接受原始预约为 revision 0，
 *       改约握手为 revision ≥ 1）。7.1A 起不再推断结束时间：V11 之前没有结束时间的原始预约不能报告爽约
 *       （NO_EXPLICIT_SLOT），可以先通过改约握手确认一个完整的新档期；</li>
 *   <li>只能在快照的结束时间再过 15 分钟之后、7 天之内提交；</li>
 *   <li>只能报告订单对方（服务端推导，客户端不能指定被报告人）；同一订单、档期版本、被报告人最多一条有效报告；</li>
 *   <li>单方报告只是 PENDING，<b>不会</b>产生任何处罚；对方可以承认（ACKNOWLEDGED，计为已确认）或提出异议
 *       （DISPUTED，自动进入工作人员复核）；报告人也可以请工作人员复核；</li>
 *   <li>「已到达」是本人手动声明，只作为事件展示给复核的工作人员，不能单独证明爽约；</li>
 *   <li>改约、见面（验货提交 / 买家确认 / 核销）后，旧档期上尚未确认的报告自动失效。</li>
 * </ul>
 *
 * <p>所有写操作先锁订单行，再锁报告行（与工作人员复核的顺序相同：报告 → 案件），不会互相死锁。
 */
@Service
public class NoShowService {

    public static final Set<String> REASONS = Set.of("DID_NOT_ARRIVE", "ARRIVED_TOO_LATE", "UNREACHABLE_AT_MEETING", "OTHER");
    private static final Set<String> REPORT_FIELDS = Set.of("reasonCode", "note");
    private static final Set<String> RESPONSE_FIELDS = Set.of("note");
    public static final Duration GRACE = Duration.ofMinutes(15);
    public static final Duration WINDOW = Duration.ofDays(7);

    private final FlowMapper flow;
    private final GovernanceMapper governance;
    private final RestrictionGuard restrictions;
    private final ModerationCases cases;
    private final RateLimitService rateLimit;
    private final OrderTransitionExecutor transitions;

    public NoShowService(FlowMapper flow, GovernanceMapper governance, RestrictionGuard restrictions, ModerationCases cases,
                         RateLimitService rateLimit, OrderTransitionExecutor transitions) {
        this.flow = flow;
        this.governance = governance;
        this.restrictions = restrictions;
        this.cases = cases;
        this.rateLimit = rateLimit;
        this.transitions = transitions;
    }

    /** 订单双方看到的爽约报告与「现在能不能报告」。 */
    public Map<String, Object> view(String uid, String orderId) {
        UUID oid = parse(orderId);
        Map<String, Object> order = flow.selectOrder(oid);
        UUID me = participant(order, uid);
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> reports = new ArrayList<>();
        for (Map<String, Object> r : governance.selectNoShowsByOrder(oid)) reports.add(project(r, me));
        result.put("reports", reports);
        result.put("eligibility", eligibility(order, me, Instant.now()));
        return result;
    }

    @Transactional
    public Map<String, Object> report(String uid, String orderId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, REPORT_FIELDS);
        String reason = code(body.get("reasonCode"), REASONS, "爽约原因");
        String note = note(body.get("note"));
        if ("OTHER".equals(reason) && note == null) throw ApiException.badRequest("选择「其他」时请写一句说明");
        UUID oid = parse(orderId);
        rateLimit.consume(RateLimitService.Scope.NO_SHOW_REPORT, uid);
        transitions.sweepExpired();
        Map<String, Object> order = flow.lockOrder(oid);
        UUID me = participant(order, uid);
        Map<String, Object> eligibility = eligibility(order, me, Instant.now());
        if (!Boolean.TRUE.equals(eligibility.get("canReport"))) {
            throw new ApiException(409, message(String.valueOf(eligibility.get("code"))), eligibility);
        }
        UUID reported = me.equals(order.get("buyer_id")) ? (UUID) order.get("seller_id") : (UUID) order.get("buyer_id");
        UUID id = UUID.randomUUID();
        int revision = ((Number) order.get("meeting_revision")).intValue();
        if (governance.insertNoShow(id, oid, revision, governance.selectOrderSchool(oid), me, reported, reason, note) == 0) {
            throw ApiException.conflict(message("ALREADY_REPORTED"));
        }
        return project(governance.selectNoShow(id), me);
    }

    /** 被报告人承认：计为已确认爽约，按公开规则可能产生预约限制（第 1 次只提醒）。 */
    @Transactional
    public Map<String, Object> acknowledge(String uid, String reportId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, RESPONSE_FIELDS);
        String note = note(body.get("note"));
        Map<String, Object> report = lockForResponse(uid, reportId);
        UUID id = (UUID) report.get("id");
        requireExplicitSlot(report);
        if (governance.respondNoShow(id, "ACKNOWLEDGED", note) != 1) throw ApiException.conflict("这份报告已经处理过");
        Map<String, Object> openCase = cases.lockOpenFor("NO_SHOW", id, DomainMapper.text(report.get("school_id")));
        UUID caseId = openCase == null ? null : (UUID) openCase.get("id");
        restrictions.applyNoShowRule((UUID) report.get("reported_user_id"), DomainMapper.text(report.get("school_id")), id, caseId, null);
        // 已请求复核的报告：对方承认即是这个案件的结果，工作人员不再需要（也不能再）做决定
        if (openCase != null) cases.resolveWithoutStaff(caseId, "CONFIRM_NO_SHOW");
        return project(governance.selectNoShow(id), UUID.fromString(uid));
    }

    /** 被报告人提出异议：不计数，自动进入工作人员复核。 */
    @Transactional
    public Map<String, Object> dispute(String uid, String reportId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, RESPONSE_FIELDS);
        String note = note(body.get("note"));
        if (note == null) throw ApiException.badRequest("请写一句说明，方便工作人员复核");
        Map<String, Object> report = lockForResponse(uid, reportId);
        UUID id = (UUID) report.get("id");
        if (governance.respondNoShow(id, "DISPUTED", note) != 1) throw ApiException.conflict("这份报告已经处理过");
        cases.ensureNoShowCase(DomainMapper.text(report.get("school_id")), id);
        return project(governance.selectNoShow(id), UUID.fromString(uid));
    }

    /** 7.1A：没有明确档期快照的报告（V11 之前的旧预约）不能被承认或确认为爽约；数据库触发器同样拒绝。 */
    void requireExplicitSlot(Map<String, Object> report) {
        if (governance.selectSlotAgreement((UUID) report.get("order_id"), ((Number) report.get("meeting_revision")).intValue()) == null) {
            throw new ApiException(409, message("NO_EXPLICIT_SLOT"), Map.of("code", "NO_EXPLICIT_SLOT"));
        }
    }

    private Map<String, Object> lockForResponse(String uid, String reportId) {
        UUID id = parse(reportId);
        Map<String, Object> probe = governance.selectNoShow(id);
        if (probe == null) throw ApiException.notFound("报告不存在");
        // 固定的加锁顺序：订单 → 报告
        flow.lockOrder((UUID) probe.get("order_id"));
        Map<String, Object> report = governance.lockNoShow(id);
        if (!UUID.fromString(uid).equals(report.get("reported_user_id"))) throw ApiException.notFound("报告不存在");
        if (!"PENDING".equals(report.get("status"))) throw ApiException.conflict("这份报告已经处理过");
        return report;
    }

    /** 能否报告；不能时给出机器码（界面只做展示）。 */
    Map<String, Object> eligibility(Map<String, Object> order, UUID me, Instant now) {
        Map<String, Object> e = new LinkedHashMap<>();
        UUID oid = (UUID) order.get("id");
        String status = DomainMapper.text(order.get("status"));
        int revision = ((Number) order.get("meeting_revision")).intValue();
        // 只认接受时冻结的档期快照；订单行上的时间不参与判断，也不推断缺失的结束时间
        Map<String, Object> slot = governance.selectSlotAgreement(oid, revision);
        Instant end = slot == null ? null : Instant.ofEpochMilli(DomainMapper.epoch(slot.get("ends_at")));
        Instant reportable = end == null ? null : end.plus(GRACE);
        Instant deadline = reportable == null ? null : reportable.plus(WINDOW);
        String code;
        if (Set.of("BUYER_CONFIRMED", "SELLER_CONFIRMED", "COMPLETED", "DISPUTED").contains(status)) code = "MET";
        else if ("PENDING_SELLER_CONFIRM".equals(status) || !governance.sellerConfirmed(oid)) code = "NO_AGREED_MEETING";
        else if (slot == null) code = "NO_EXPLICIT_SLOT";
        else if (now.isBefore(reportable)) code = "TOO_EARLY";
        else if (now.isAfter(deadline)) code = "WINDOW_CLOSED";
        else if ("CANCELLED".equals(status) && cancelledBefore(oid, reportable)) code = "CANCELLED_BEFORE_MEETING";
        else if (alreadyReported(oid, me, revision)) code = "ALREADY_REPORTED";
        else code = "OK";
        boolean agreed = slot != null && !"MET".equals(code) && !"NO_AGREED_MEETING".equals(code);
        e.put("canReport", "OK".equals(code));
        e.put("code", code);
        e.put("reportableAt", agreed ? reportable.toEpochMilli() : null);
        e.put("deadline", agreed ? deadline.toEpochMilli() : null);
        // 判断所依据的档期快照（没有快照时为 null）
        e.put("slot", slot == null ? null : slotView(slot));
        return e;
    }

    static Map<String, Object> slotView(Map<String, Object> slot) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("revision", ((Number) slot.get("meeting_revision")).intValue());
        m.put("startsAt", DomainMapper.epoch(slot.get("starts_at")));
        m.put("endsAt", DomainMapper.epoch(slot.get("ends_at")));
        m.put("agreedAt", DomainMapper.epoch(slot.get("agreed_at")));
        return m;
    }

    private boolean cancelledBefore(UUID orderId, Instant reportable) {
        java.time.OffsetDateTime at = governance.selectCancelledAt(orderId);
        return at == null || at.toInstant().isBefore(reportable);
    }

    private boolean alreadyReported(UUID orderId, UUID reporter, int revision) {
        for (Map<String, Object> r : governance.selectNoShowsByOrder(orderId)) {
            if (reporter.equals(r.get("reporter_user_id")) && revision == ((Number) r.get("meeting_revision")).intValue()
                    && Set.of("PENDING", "ACKNOWLEDGED", "DISPUTED", "CONFIRMED").contains(DomainMapper.text(r.get("status")))) return true;
        }
        return false;
    }

    /** 订单双方看到的报告：双方本来就知道彼此是谁，这里不额外暴露任何账号或联系方式。 */
    Map<String, Object> project(Map<String, Object> r, UUID me) {
        Map<String, Object> m = new LinkedHashMap<>();
        String status = DomainMapper.text(r.get("status"));
        boolean byMe = me.equals(r.get("reporter_user_id"));
        boolean aboutMe = me.equals(r.get("reported_user_id"));
        m.put("id", DomainMapper.text(r.get("id")));
        m.put("orderId", DomainMapper.text(r.get("order_id")));
        m.put("meetingRevision", ((Number) r.get("meeting_revision")).intValue());
        m.put("status", status);
        m.put("reasonCode", DomainMapper.text(r.get("reason_code")));
        m.put("note", DomainMapper.nullableText(r.get("note")));
        m.put("responseNote", DomainMapper.nullableText(r.get("response_note")));
        m.put("byMe", byMe);
        m.put("aboutMe", aboutMe);
        m.put("createdAt", DomainMapper.epoch(r.get("created_at")));
        m.put("respondedAt", r.get("responded_at") == null ? null : DomainMapper.epoch(r.get("responded_at")));
        m.put("decidedAt", r.get("decided_at") == null ? null : DomainMapper.epoch(r.get("decided_at")));
        m.put("canRespond", aboutMe && "PENDING".equals(status));
        m.put("canEscalate", byMe && "PENDING".equals(status)
                && cases.openFor(DomainMapper.text(r.get("school_id")), "NO_SHOW", (UUID) r.get("id")) == null);
        return m;
    }

    private static UUID participant(Map<String, Object> order, String uid) {
        if (order == null) throw ApiException.notFound("订单不存在");
        UUID me = UUID.fromString(uid);
        if (!me.equals(order.get("buyer_id")) && !me.equals(order.get("seller_id"))) throw ApiException.notFound("订单不存在");
        return me;
    }

    static String message(String code) {
        return switch (code) {
            case "NO_AGREED_MEETING" -> "这张订单还没有双方确认过的档期，不能报告爽约";
            case "NO_EXPLICIT_SLOT" -> "原始预约没有明确的结束时间，不能据此认定爽约；可以先通过改约确认一个完整的新档期";
            case "TOO_EARLY" -> "档期结束 15 分钟之后才能报告爽约";
            case "WINDOW_CLOSED" -> "已超过报告期限（档期结束后 7 天内）";
            case "MET" -> "双方已经见面（已验货或已确认），不能报告爽约";
            case "CANCELLED_BEFORE_MEETING" -> "订单在档期之前已经取消，不能报告爽约";
            case "ALREADY_REPORTED" -> "你已经就这个档期报告过";
            default -> "现在不能报告爽约";
        };
    }

    static String code(Object raw, Set<String> allowed, String label) {
        String value = raw == null ? "" : String.valueOf(raw);
        if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效");
        return value;
    }

    /** 说明：可选，1～200 字，不含尖括号（不接受 HTML）。 */
    static String note(Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof String s)) throw ApiException.badRequest("说明格式无效");
        String value = s.trim();
        if (value.isEmpty()) return null;
        if (value.length() > 200 || value.matches("(?s).*[<>].*")) throw ApiException.badRequest("说明最多 200 字，且不能包含尖括号");
        return value;
    }

    static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.notFound("记录不存在");
        }
    }
}
