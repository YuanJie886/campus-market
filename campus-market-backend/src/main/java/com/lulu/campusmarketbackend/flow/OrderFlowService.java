package com.lulu.campusmarketbackend.flow;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.mapper.FlowMapper;
import com.lulu.campusmarketbackend.mapper.InspectionMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.OrderTransitionExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * 可信面交闭环：验货提交、档期握手、出发/已到、订单流程视图（模块 3.3～3.5）。
 *
 * <p>同一订单上的所有写操作先锁订单行（{@code FOR UPDATE}），再做判断与写入：
 * 并发的接受、提交、到达请求在这里串行化，数据库的部分唯一索引与触发器是最后一道防线。
 *
 * <p>权限的统一语义：非订单双方一律 404（不暴露订单是否存在）；
 * 订单一方做了只有另一方能做的事（卖家替买家验货、自己接受自己的提议）返回 403。
 */
@Service
public class OrderFlowService {

    private static final Set<String> INSPECTION_BODY_FIELDS = Set.of("items");
    private static final Set<String> INSPECTION_ITEM_FIELDS = Set.of("itemCode", "result", "note");
    private static final Set<String> RESULTS = Set.of("MATCH", "MISMATCH", "NOT_CHECKABLE");
    private static final Set<String> PROPOSAL_FIELDS = Set.of("meetingPointId", "startsAtIso", "endsAtIso", "note");
    private static final Set<String> PRESENCE_FIELDS = Set.of("action");
    /** 可以约时间的订单状态：卖家待确认（可以还价时间）与待面交。 */
    /**
     * 可以约定正式档期的订单状态（3.8B）：只有卖家接受预约之后的真实面交阶段。
     * 卖家接受前的时间只是买家下单时的「预约意向」，不是双方握手确认的档期。
     */
    private static final Set<String> SCHEDULABLE = Set.of("PENDING_MEETING");
    /** 可以同步到达状态的订单状态：双方已有一致的档期、交易尚未结束。 */
    private static final Set<String> PRESENCE_ALLOWED = Set.of("PENDING_MEETING", "BUYER_CONFIRMED");
    private static final Set<String> TERMINAL = Set.of("COMPLETED", "CANCELLED", "EXPIRED");
    private static final int MAX_PROPOSAL_NOTE = 100;

    private final FlowMapper flow;
    private final InspectionMapper inspections;
    private final OrderTransitionExecutor transitions;

    private final com.lulu.campusmarketbackend.mapper.GovernanceMapper governance;

    public OrderFlowService(FlowMapper flow, InspectionMapper inspections, OrderTransitionExecutor transitions,
                            com.lulu.campusmarketbackend.mapper.GovernanceMapper governance) {
        this.governance = governance;
        this.flow = flow;
        this.inspections = inspections;
        this.transitions = transitions;
    }

    /** 订单参与方视角。 */
    private record Party(Map<String, Object> order, UUID me, boolean buyer) {
        UUID counterpart() {
            return (UUID) order.get(buyer ? "seller_id" : "buyer_id");
        }
        String status() {
            return String.valueOf(order.get("status"));
        }
        int revision() {
            return ((Number) order.get("meeting_revision")).intValue();
        }
    }

    private Party party(Map<String, Object> order, String uid) {
        if (order == null) throw ApiException.notFound("订单不存在");
        UUID me = UUID.fromString(uid);
        boolean buyer = me.equals(order.get("buyer_id"));
        if (!buyer && !me.equals(order.get("seller_id"))) throw ApiException.notFound("订单不存在");
        return new Party(order, me, buyer);
    }

    /** 写操作入口：先清扫超时（与既有状态迁移一致），再锁订单行。 */
    private Party lockParty(String uid, String orderId) {
        UUID id = parseId(orderId);
        transitions.sweepExpired();
        return party(flow.lockOrder(id), uid);
    }

    // ==================================================================
    // 3.3 验货
    // ==================================================================

    /** 保存买家草稿。可重复保存；未提交的条目允许为空。 */
    @Transactional
    public Map<String, Object> saveInspectionDraft(String uid, String orderId, Map<String, Object> body) {
        return writeInspection(uid, orderId, body, false);
    }

    /**
     * 最终提交。幂等：已提交后再次提交相同内容返回原结果；内容不同返回 409——记录不可修改。
     * 存在任何 MISMATCH 时，订单进入 DISPUTED，只能取消，不能再确认或核销。
     */
    @Transactional
    public Map<String, Object> submitInspection(String uid, String orderId, Map<String, Object> body) {
        return writeInspection(uid, orderId, body, true);
    }

    private Map<String, Object> writeInspection(String uid, String orderId, Map<String, Object> body, boolean finalSubmit) {
        JsonFieldPolicy.rejectUnknown(body, INSPECTION_BODY_FIELDS);
        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        if (!p.buyer()) throw ApiException.forbidden("只有买家可以填写验货结果");

        Map<String, Object> inspection = inspections.selectInspectionForUpdate(oid);
        if (inspection == null || "NOT_PROVIDED".equals(inspection.get("status"))) {
            throw ApiException.conflict("该订单没有结构化验货清单");
        }
        List<Map<String, Object>> items = inspections.selectInspectionItems(oid);
        Map<String, InspectionMapper.ResultRow> submitted = parseResults(body, items, finalSubmit);

        String status = String.valueOf(inspection.get("status"));
        if (!"PENDING".equals(status)) {
            // 已经是最终记录：相同内容视为幂等重放，不同内容一律拒绝
            if (finalSubmit && sameAsStored(submitted, items)) return view(uid, orderId);
            throw ApiException.conflict("验货已提交，记录不可修改");
        }
        if (!"PENDING_MEETING".equals(p.status())) {
            throw ApiException.conflict("只有在待面交阶段才能填写验货结果");
        }

        if (!submitted.isEmpty()) inspections.updateBuyerResults(oid, new ArrayList<>(submitted.values()), finalSubmit);
        if (finalSubmit) {
            boolean mismatch = submitted.values().stream().anyMatch(r -> "MISMATCH".equals(r.result()));
            inspections.markSubmitted(oid, mismatch ? "NEEDS_RESOLUTION" : "SUBMITTED", mismatch, p.me());
            flow.insertFlowEvent(oid, p.me(), "INSPECTION_SUBMITTED", null);
            if (mismatch) {
                flow.insertFlowEvent(oid, p.me(), "INSPECTION_MISMATCH", null);
                // 买家明确提交了「不一致」：订单进入争议，只能取消（商品随之释放）或到期自动释放
                if (flow.moveStatus(oid, "PENDING_MEETING", "DISPUTED") == 1) {
                    flow.insertOrderEvent(UUID.randomUUID(), oid, p.me(), "PENDING_MEETING", "DISPUTED", "INSPECTION_MISMATCH");
                }
            }
            // 模块 7：提交验货说明双方已经见面，这张订单上尚未确认的爽约报告失效
            governance.expireNoShowsBefore(oid, Integer.MAX_VALUE);
        }
        return view(uid, orderId);
    }

    private static Map<String, InspectionMapper.ResultRow> parseResults(Map<String, Object> body,
                                                                        List<Map<String, Object>> items,
                                                                        boolean finalSubmit) {
        Set<String> codes = new HashSet<>();
        for (Map<String, Object> item : items) codes.add(String.valueOf(item.get("item_code")));
        Object raw = body == null ? null : body.get("items");
        if (!(raw instanceof List<?> list)) throw ApiException.badRequest("请提交验货条目");

        Map<String, InspectionMapper.ResultRow> result = new LinkedHashMap<>();
        for (Object element : list) {
            if (!(element instanceof Map<?, ?> map)) throw ApiException.badRequest("验货条目格式无效");
            for (Object key : map.keySet()) {
                if (!INSPECTION_ITEM_FIELDS.contains(String.valueOf(key))) {
                    throw ApiException.badRequest("验货条目包含不支持的字段：" + key);
                }
            }
            String code = map.get("itemCode") instanceof String s ? s : null;
            if (code == null || !codes.contains(code)) throw ApiException.badRequest("验货条目不存在");
            if (result.containsKey(code)) throw ApiException.badRequest("验货条目重复");
            Object rawResult = map.get("result");
            String value = rawResult instanceof String s ? s : null;
            if (rawResult != null && (value == null || !RESULTS.contains(value))) {
                throw ApiException.badRequest("验货结果无效");
            }
            if (finalSubmit && value == null) throw ApiException.badRequest("提交前请逐项给出结果");
            result.put(code, new InspectionMapper.ResultRow(code, value, note(map.get("note"), 200)));
        }
        if (finalSubmit && !result.keySet().equals(codes)) throw ApiException.badRequest("提交前请逐项给出结果");
        return result;
    }

    private static boolean sameAsStored(Map<String, InspectionMapper.ResultRow> submitted, List<Map<String, Object>> items) {
        if (submitted.size() != items.size()) return false;
        for (Map<String, Object> item : items) {
            InspectionMapper.ResultRow row = submitted.get(String.valueOf(item.get("item_code")));
            if (row == null || !Objects.equals(row.result(), item.get("buyer_result"))
                    || !Objects.equals(row.note(), DomainMapper.text(item.get("buyer_note")))) return false;
        }
        return true;
    }

    // ==================================================================
    // 3.4 档期握手
    // ==================================================================

    /**
     * 提出档期。原有的当前协议在对方接受之前<b>继续有效</b>——提议不会清空任何东西。
     */
    @Transactional
    public Map<String, Object> propose(String uid, String orderId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, PROPOSAL_FIELDS);
        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        requireSchedulable(p);

        String pointId = body.get("meetingPointId") instanceof String s ? s : null;
        Map<String, Object> point = pointId == null ? null : flow.selectMeetingPoint(pointId);
        if (point == null) throw ApiException.badRequest("面交点不存在");
        if (!Boolean.TRUE.equals(point.get("active"))) throw ApiException.badRequest("该面交点已停用，请选择其他面交点");
        if (!DomainMapper.text(point.get("campus_id")).equals(DomainMapper.text(p.order().get("product_campus")))) {
            throw ApiException.badRequest("请选择商品所在校区的面交点");
        }

        OffsetDateTime starts = slot(body.get("startsAtIso"), "开始时间");
        OffsetDateTime ends = slot(body.get("endsAtIso"), "结束时间");
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        if (!ends.isAfter(starts)) throw ApiException.badRequest("结束时间必须晚于开始时间");
        if (ends.isAfter(starts.plusHours(2))) throw ApiException.badRequest("单次面交时段最长 2 小时");
        if (!starts.isAfter(now)) throw ApiException.badRequest("不能选择已经过去的时间");
        if (starts.isAfter(now.plusDays(30))) throw ApiException.badRequest("只能约 30 天内的时间");

        if (flow.countPending(oid) > 0) throw ApiException.conflict("已有待处理的档期提议，请先接受、拒绝或撤回");
        flow.insertProposal(UUID.randomUUID(), oid, p.me(), pointId, starts, ends, note(body.get("note"), MAX_PROPOSAL_NOTE));
        flow.insertFlowEvent(oid, p.me(), "MEETING_PROPOSED", null);
        return view(uid, orderId);
    }

    /**
     * 接受对方的提议：旧协议标记 SUPERSEDED，新协议生效，版本号 +1，到达状态随新版本重新开始。
     * 订单行锁 + 「一个订单一个 ACCEPTED」部分唯一索引，保证并发接受不会产生两个当前档期。
     */
    @Transactional
    public Map<String, Object> accept(String uid, String orderId, String proposalId) {
        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        Map<String, Object> proposal = proposal(oid, proposalId);
        if (p.me().equals(proposal.get("proposer_id"))) throw ApiException.forbidden("不能接受自己提出的档期");
        String status = String.valueOf(proposal.get("status"));
        if ("ACCEPTED".equals(status) && p.me().equals(proposal.get("responded_by"))) return view(uid, orderId);
        if (!"PENDING".equals(status)) throw ApiException.conflict("该提议已经处理过了");
        requireSchedulable(p);

        Map<String, Object> point = flow.selectMeetingPoint(DomainMapper.text(proposal.get("meeting_point_id")));
        if (point == null || !Boolean.TRUE.equals(point.get("active"))) {
            throw ApiException.conflict("该面交点已停用，请对方重新提议");
        }
        OffsetDateTime starts = odt(proposal.get("starts_at"));
        OffsetDateTime ends = odt(proposal.get("ends_at"));
        if (!starts.isAfter(OffsetDateTime.now(ZoneOffset.UTC))) throw ApiException.conflict("该档期已经过去，请重新提议");

        int revision = p.revision() + 1;
        flow.supersedeCurrent(oid);
        if (flow.acceptProposal((UUID) proposal.get("id"), revision, p.me()) != 1) {
            throw ApiException.conflict("该提议已经处理过了");
        }
        flow.applyAgreement(oid, DomainMapper.text(proposal.get("meeting_point_id")), starts, ends, revision,
                expiresAfterAgreement(p.status(), starts));
        flow.insertFlowEvent(oid, p.me(), "MEETING_ACCEPTED", revision);
        // 模块 7：改约生效后，旧档期上尚未确认的爽约报告失效（订单行已锁，与提交报告串行化）
        governance.expireNoShowsBefore(oid, revision);
        return view(uid, orderId);
    }

    /**
     * 新协议生效后的过期时间，与既有规则同一口径：
     * 待面交 = 面交开始 + 1 天（与 OrderTransitionExecutor 接单时的规则一致）；
     * 卖家待确认 = min(面交开始, 现在 + 1 天)（与下单时的规则一致）。
     * 改约到更晚的时间会同步推迟过期，旧的过期时间不会提前释放仍在正常面交中的商品。
     */
    private static OffsetDateTime expiresAfterAgreement(String status, OffsetDateTime starts) {
        // 3.8B 起只有 PENDING_MEETING 能接受档期，与卖家接单时 meetingAt + 1 天同一口径
        return starts.plusDays(1);
    }

    @Transactional
    public Map<String, Object> reject(String uid, String orderId, String proposalId) {
        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        Map<String, Object> proposal = proposal(oid, proposalId);
        if (p.me().equals(proposal.get("proposer_id"))) throw ApiException.forbidden("不能拒绝自己提出的档期，请改为撤回");
        String status = String.valueOf(proposal.get("status"));
        if ("REJECTED".equals(status) && p.me().equals(proposal.get("responded_by"))) return view(uid, orderId);
        if (!"PENDING".equals(status)) throw ApiException.conflict("该提议已经处理过了");
        if (TERMINAL.contains(p.status())) throw ApiException.conflict("订单已结束");
        flow.closeProposal((UUID) proposal.get("id"), "REJECTED", p.me());
        flow.insertFlowEvent(oid, p.me(), "MEETING_REJECTED", null);
        return view(uid, orderId);
    }

    @Transactional
    public Map<String, Object> withdraw(String uid, String orderId, String proposalId) {
        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        Map<String, Object> proposal = proposal(oid, proposalId);
        if (!p.me().equals(proposal.get("proposer_id"))) throw ApiException.forbidden("只能撤回自己提出的档期");
        String status = String.valueOf(proposal.get("status"));
        if ("WITHDRAWN".equals(status)) return view(uid, orderId);
        if (!"PENDING".equals(status)) throw ApiException.conflict("该提议已经处理过了");
        if (TERMINAL.contains(p.status())) throw ApiException.conflict("订单已结束");
        flow.closeProposal((UUID) proposal.get("id"), "WITHDRAWN", p.me());
        flow.insertFlowEvent(oid, p.me(), "MEETING_WITHDRAWN", null);
        return view(uid, orderId);
    }

    private Map<String, Object> proposal(UUID orderId, String proposalId) {
        Map<String, Object> proposal = flow.selectProposal(parseId(proposalId), orderId);
        if (proposal == null) throw ApiException.notFound("提议不存在");
        return proposal;
    }

    private static void requireSchedulable(Party p) {
        if (TERMINAL.contains(p.status())) throw ApiException.conflict("订单已结束，不能再约时间");
        if ("PENDING_SELLER_CONFIRM".equals(p.status())) throw ApiException.conflict("卖家接受预约后，才能约定正式面交档期");
        if (!SCHEDULABLE.contains(p.status())) throw ApiException.conflict("当前订单状态不能再改约");
    }

    /**
     * 离散时间段：必须是整点或半点、秒为 0。前端从固定时间段里选，
     * 服务端不接受任意分钟数，也不接受自由文本代替时间。
     */
    private static OffsetDateTime slot(Object raw, String label) {
        if (!(raw instanceof String text)) throw ApiException.badRequest(label + "格式无效");
        OffsetDateTime value;
        try {
            value = OffsetDateTime.parse(text).withOffsetSameInstant(ZoneOffset.UTC);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest(label + "格式无效");
        }
        if (value.getSecond() != 0 || value.getNano() != 0 || value.getMinute() % 30 != 0) {
            throw ApiException.badRequest(label + "必须是整点或半点");
        }
        return value;
    }

    // ==================================================================
    // 3.5 出发 / 已到
    // ==================================================================

    /**
     * 更新本人状态。只接受 DEPART / ARRIVE 两个动作，时间由服务端生成。
     * 重复动作幂等；已到达后不能退回出发；到达<b>不会</b>完成订单、提交验货或暴露联系方式。
     */
    @Transactional
    public Map<String, Object> updatePresence(String uid, String orderId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, PRESENCE_FIELDS);
        String action = body.get("action") instanceof String s ? s : null;
        if (!"DEPART".equals(action) && !"ARRIVE".equals(action)) throw ApiException.badRequest("动作无效");

        Party p = lockParty(uid, orderId);
        UUID oid = (UUID) p.order().get("id");
        if (TERMINAL.contains(p.status())) throw ApiException.conflict("订单已结束");
        if (!PRESENCE_ALLOWED.contains(p.status())) throw ApiException.conflict("卖家接单、档期确定后才能同步到达状态");

        int revision = p.revision();
        String current = "NOT_STARTED";
        for (Map<String, Object> row : flow.selectPresence(oid, revision)) {
            if (p.me().equals(row.get("user_id"))) current = String.valueOf(row.get("status"));
        }

        // 订单行锁已把同一订单上的请求串行化。下面的写入仍然各自带条件
        // （插入 ON CONFLICT DO NOTHING、到达只从 DEPARTED 推进、触发器禁止倒退），
        // 即使将来有人绕开这把锁，也只会得到幂等结果而不是 500 或倒退状态。
        // 事件只在状态真的发生变化时记录一次。
        if ("DEPART".equals(action)) {
            if ("DEPARTED".equals(current)) return view(uid, orderId);                  // 幂等
            if ("ARRIVED".equals(current)) throw ApiException.conflict("已经到达，不能退回「已出发」");
            if (flow.insertPresence(oid, p.me(), revision, "DEPARTED") == 1) {
                flow.insertFlowEvent(oid, p.me(), "PRESENCE_DEPARTED", revision);
            }
        } else {
            if ("ARRIVED".equals(current)) return view(uid, orderId);                   // 幂等
            // 允许不经「出发」直接「已到」（例如同楼自提）；此时不伪造出发时间
            int changed = "DEPARTED".equals(current)
                    ? flow.markArrived(oid, p.me(), revision)
                    : flow.insertPresence(oid, p.me(), revision, "ARRIVED");
            if (changed == 0) changed = flow.markArrived(oid, p.me(), revision);   // 并发下对方先插入了 DEPARTED
            if (changed == 1) flow.insertFlowEvent(oid, p.me(), "PRESENCE_ARRIVED", revision);
        }
        return view(uid, orderId);
    }

    // ==================================================================
    // 订单流程视图（只有订单双方可见）
    // ==================================================================

    public Map<String, Object> view(String uid, String orderId) {
        UUID oid = parseId(orderId);
        Party p = party(flow.selectOrder(oid), uid);
        Map<String, Object> order = p.order();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("orderId", oid.toString());
        result.put("status", p.status());
        result.put("role", p.buyer() ? "BUYER" : "SELLER");

        Map<String, Object> agreement = new LinkedHashMap<>();
        Map<String, Object> point = flow.selectMeetingPoint(DomainMapper.text(order.get("meeting_point_id")));
        agreement.put("revision", p.revision());
        agreement.put("meetingPointId", DomainMapper.text(order.get("meeting_point_id")));
        agreement.put("meetingPointName", point == null ? null : DomainMapper.text(point.get("name")));
        agreement.put("startsAtIso", iso(order.get("meeting_at")));
        agreement.put("endsAtIso", iso(order.get("meeting_ends_at")));
        // 卖家接单之前，下单时的档期只是买家的提议，还不是双方一致的协议
        agreement.put("confirmed", !"PENDING_SELLER_CONFIRM".equals(p.status()) || p.revision() > 0);
        // 7.1A：当前版本是否有接受时冻结的完整档期快照；V11 之前没有结束时间的原始预约为 false（界面提示可通过改约补一个完整档期）
        agreement.put("explicitSlot", governance.selectSlotAgreement(oid, p.revision()) != null);
        result.put("agreement", agreement);

        List<Map<String, Object>> proposals = new ArrayList<>();
        for (Map<String, Object> row : flow.selectProposals(oid)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", DomainMapper.text(row.get("id")));
            item.put("proposedBy", ((UUID) row.get("proposer_id")).equals(order.get("buyer_id")) ? "BUYER" : "SELLER");
            item.put("mine", p.me().equals(row.get("proposer_id")));
            item.put("meetingPointId", DomainMapper.text(row.get("meeting_point_id")));
            item.put("meetingPointName", DomainMapper.text(row.get("meeting_point_name")));
            item.put("startsAtIso", iso(row.get("starts_at")));
            item.put("endsAtIso", iso(row.get("ends_at")));
            item.put("note", DomainMapper.text(row.get("note")));
            item.put("status", DomainMapper.text(row.get("status")));
            item.put("revision", row.get("revision"));
            item.put("createdAtIso", iso(row.get("created_at")));
            item.put("respondedAtIso", iso(row.get("responded_at")));
            proposals.add(item);
        }
        result.put("proposals", proposals);

        Map<String, Object> presence = new LinkedHashMap<>();
        presence.put("revision", p.revision());
        Map<String, Object> mine = presenceOf(null), theirs = presenceOf(null);
        for (Map<String, Object> row : flow.selectPresence(oid, p.revision())) {
            if (p.me().equals(row.get("user_id"))) mine = presenceOf(row);
            else if (p.counterpart().equals(row.get("user_id"))) theirs = presenceOf(row);
        }
        presence.put("me", mine);
        presence.put("counterpart", theirs);
        result.put("presence", presence);
        // 模块 7：订单双方看到的取消事实（阶段、结构化原因、说明、是否由我发起）；公共履历里没有这一项
        Map<String, Object> cancel = governance.selectCancellation(oid);
        if (cancel == null) {
            result.put("cancellation", null);
        } else {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("phase", DomainMapper.text(cancel.get("phase")));
            c.put("reasonCode", DomainMapper.nullableText(cancel.get("reason_code")));
            c.put("note", DomainMapper.nullableText(cancel.get("note")));
            c.put("byMe", p.me().equals(cancel.get("actor_user_id")));
            c.put("createdAt", DomainMapper.epoch(cancel.get("created_at")));
            result.put("cancellation", c);
        }

        // 验货头只读一次：验货视图与「能否确认」共用
        Map<String, Object> inspectionRow = inspections.selectInspection(oid);
        result.put("inspection", inspectionView(inspectionRow, oid, p.buyer()));
        String inspectionStatus = inspectionRow == null ? null : DomainMapper.text(inspectionRow.get("status"));
        String blockReason = OrderActionability.buyerConfirmBlockReason(p.status(), inspectionStatus);
        result.put("buyerConfirmAllowed", blockReason == null);
        result.put("buyerConfirmBlockReason", blockReason);
        result.put("currentMeetingStatus", OrderActionability.meetingStatus(p.status(),
                proposals.stream().anyMatch(x -> "PENDING".equals(x.get("status")))));
        result.put("timeline", timeline(oid, order));
        return result;
    }

    private static Map<String, Object> presenceOf(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", row == null ? "NOT_STARTED" : DomainMapper.text(row.get("status")));
        result.put("departedAtIso", row == null ? null : iso(row.get("departed_at")));
        result.put("arrivedAtIso", row == null ? null : iso(row.get("arrived_at")));
        return result;
    }

    /**
     * 验货视图。模块 3 之前的旧订单没有任何记录，返回 status=LEGACY_NONE，由界面如实说明。
     * 买家的草稿只有买家自己能看到；卖家要等买家最终提交后才能看到结果。
     */
    private Map<String, Object> inspectionView(Map<String, Object> inspection, UUID oid, boolean viewerIsBuyer) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (inspection == null) {
            result.put("status", "LEGACY_NONE");
            result.put("items", List.of());
            return result;
        }
        String status = DomainMapper.text(inspection.get("status"));
        boolean finalised = "SUBMITTED".equals(status) || "NEEDS_RESOLUTION".equals(status);
        result.put("status", status);
        result.put("templateTitle", DomainMapper.nullableText(inspection.get("template_title_snapshot")));
        result.put("templateVersion", inspection.get("template_version"));
        result.put("hasMismatch", Boolean.TRUE.equals(inspection.get("has_mismatch")));
        result.put("submittedAtIso", iso(inspection.get("submitted_at")));
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : inspections.selectInspectionItems(oid)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("code", DomainMapper.text(row.get("item_code")));
            item.put("label", DomainMapper.text(row.get("label_snapshot")));
            item.put("description", DomainMapper.text(row.get("description_snapshot")));
            item.put("required", Boolean.TRUE.equals(row.get("required_snapshot")));
            item.put("sellerCondition", DomainMapper.nullableText(row.get("seller_condition_snapshot")));
            item.put("sellerNote", DomainMapper.text(row.get("seller_note_snapshot")));
            boolean visible = viewerIsBuyer || finalised;
            item.put("buyerResult", visible ? DomainMapper.nullableText(row.get("buyer_result")) : null);
            item.put("buyerNote", visible ? DomainMapper.text(row.get("buyer_note")) : "");
            item.put("checkedAtIso", visible ? iso(row.get("checked_at")) : null);
            items.add(item);
        }
        result.put("items", items);
        return result;
    }


    /** 同一事务内写入的事件时间相同；按事件的逻辑先后给一个固定次序，保证时间线稳定。 */
    private static final List<String> LOGICAL_ORDER = List.of(
            "ORDER_CREATED", "MEETING_PROPOSED", "MEETING_REJECTED", "MEETING_WITHDRAWN", "MEETING_ACCEPTED",
            "SELLER_ACCEPTED", "PRESENCE_DEPARTED", "PRESENCE_ARRIVED", "INSPECTION_SUBMITTED", "INSPECTION_MISMATCH",
            "ORDER_DISPUTED", "BUYER_CONFIRMED", "SELLER_VERIFIED", "ORDER_COMPLETED", "ORDER_CANCELLED", "ORDER_EXPIRED");

    private List<Map<String, Object>> timeline(UUID oid, Map<String, Object> order) {
        List<Map<String, Object>> events = new ArrayList<>();
        for (Map<String, Object> row : flow.selectTimeline(oid)) {
            String code = "ORDER".equals(row.get("source"))
                    ? orderEventCode(DomainMapper.nullableText(row.get("from_status")), DomainMapper.text(row.get("to_status")))
                    : DomainMapper.text(row.get("event_code"));
            if (code == null) continue;
            Map<String, Object> event = new HashMap<>();
            event.put("code", code);
            Object actor = row.get("actor_id");
            event.put("actor", actor == null ? "SYSTEM" : actor.equals(order.get("buyer_id")) ? "BUYER" : "SELLER");
            event.put("meetingRevision", row.get("meeting_revision"));
            event.put("atIso", iso(row.get("created_at")));
            event.put("_at", row.get("created_at"));
            event.put("_seq", ((Number) row.get("seq")).longValue());
            event.put("_ref", DomainMapper.text(row.get("ref")));
            events.add(event);
        }
        events.sort(Comparator
                .comparing((Map<String, Object> e) -> odt(e.get("_at")).toInstant())
                .thenComparingInt(e -> LOGICAL_ORDER.indexOf((String) e.get("code")))
                .thenComparingLong(e -> (Long) e.get("_seq"))
                .thenComparing(e -> (String) e.get("_ref")));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> e : events) {
            Map<String, Object> clean = new LinkedHashMap<>();
            clean.put("code", e.get("code"));
            clean.put("actor", e.get("actor"));
            clean.put("meetingRevision", e.get("meetingRevision"));
            clean.put("atIso", e.get("atIso"));
            result.add(clean);
        }
        return result;
    }

    /** 订单状态事件 → 稳定机器码。中文只在前端映射。 */
    private static String orderEventCode(String from, String to) {
        return switch (to) {
            case "PENDING_SELLER_CONFIRM" -> from == null ? "ORDER_CREATED" : null;
            case "PENDING_MEETING" -> "SELLER_ACCEPTED";
            case "BUYER_CONFIRMED" -> "BUYER_CONFIRMED";
            case "SELLER_CONFIRMED" -> "SELLER_VERIFIED";
            case "COMPLETED" -> "ORDER_COMPLETED";
            case "CANCELLED" -> "ORDER_CANCELLED";
            case "EXPIRED" -> "ORDER_EXPIRED";
            case "DISPUTED" -> "ORDER_DISPUTED";
            default -> null;
        };
    }

    // ==================================================================

    private static String note(Object raw, int max) {
        if (raw == null) return "";
        if (!(raw instanceof String text)) throw ApiException.badRequest("备注格式无效");
        String value = text.strip();
        if (value.length() > max) throw ApiException.badRequest("备注最多 " + max + " 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest("备注不能包含尖括号");
        return value;
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("订单不存在");
        }
    }

    /** JDBC 对 timestamptz 可能返回 Timestamp 或 OffsetDateTime，这里统一换成 UTC 的 OffsetDateTime。 */
    private static OffsetDateTime odt(Object value) {
        if (value instanceof OffsetDateTime o) return o.withOffsetSameInstant(ZoneOffset.UTC);
        if (value instanceof java.sql.Timestamp t) return t.toInstant().atOffset(ZoneOffset.UTC);
        throw new IllegalStateException("无法识别的时间类型：" + value);
    }

    private static String iso(Object value) {
        if (value == null) return null;
        if (value instanceof OffsetDateTime o) return o.withOffsetSameInstant(ZoneOffset.UTC).toString();
        if (value instanceof java.sql.Timestamp t) return t.toInstant().toString();
        return String.valueOf(value);
    }
}
