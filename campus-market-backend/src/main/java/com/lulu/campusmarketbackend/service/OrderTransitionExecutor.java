package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.entity.OrderEntity;
import com.lulu.campusmarketbackend.entity.OrderEventEntity;
import com.lulu.campusmarketbackend.mapper.OrderEventMapper;
import com.lulu.campusmarketbackend.mapper.OrderMapper;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.lulu.campusmarketbackend.service.DomainMapper.map;

/**
 * 订单状态迁移的事务执行器。
 *
 * <p>存在的唯一理由是修复 R-02：错误确认码的计数必须被<b>提交</b>，而 HTTP 错误必须
 * 在事务<b>之外</b>抛出。原实现把两件事放在同一个 {@code @Transactional} 方法里——
 * 先 {@code incrementCodeAttempts} 再抛继承自 {@code RuntimeException} 的
 * {@code ApiException}，Spring 默认回滚规则把计数一并撤销，使
 * {@code code_attempts} 永远停在 0、5 次上限永不可达。
 *
 * <p>因此这里把事务边界下沉一层：
 * <ul>
 *   <li>{@link #execute} 是带事务的核心，错误确认码走<b>正常返回</b>
 *       （{@link Result#WRONG_CODE} / {@link Result#CODE_LOCKED}），计数随事务提交；</li>
 *   <li>{@code OrderService.transition()} 本身不再带事务，拿到结果后在事务外抛 HTTP 异常。</li>
 * </ul>
 *
 * <p>刻意<b>不</b>采用的几种做法：
 * <ul>
 *   <li>不给整个方法加 {@code noRollbackFor = ApiException.class}——那会让「订单不存在」
 *       「无权限」「状态不允许」等路径也可能提交中途写入，事务边界过宽；</li>
 *   <li>不在持有订单行锁的外层事务里用 {@code REQUIRES_NEW} 更新同一行——外层持锁等内层提交、
 *       内层等外层放锁，会自阻塞到超时；</li>
 *   <li>不依赖同类内部自调用——{@link #execute} 与 {@link #sweepExpired} 都由外部 Bean
 *       经 Spring 代理调用，内部只调用未加注解的私有方法。</li>
 * </ul>
 *
 * <p>并发安全由数据库保证：{@code selectForUpdate} 在事务内锁住订单行，
 * 「读计数 → 判上限 → 加计数」全程处于同一把行锁范围内，并发请求被串行化；
 * {@code incrementCodeAttempts} 的 SQL 另带 {@code code_attempts < max} 条件作为硬不变量。
 */
@Service
public class OrderTransitionExecutor {

    /** 单个订单允许的确认码错误次数上限，达到即锁定。 */
    public static final int MAX_CODE_ATTEMPTS = 5;

    private final ProductMapper products;
    private final OrderMapper orders;
    private final OrderEventMapper events;
    private final DomainMapper mapper;
    private final com.lulu.campusmarketbackend.mapper.InspectionMapper inspections;
    /** BUYER_CONFIRMED 停留多久后自动过期，与早期订单的 expires_at 是两套独立阈值。 */
    private final int buyerConfirmedExpiryHours;

    /** 模块 7：取消记录与爽约报告失效 */
    private final com.lulu.campusmarketbackend.mapper.GovernanceMapper governance;

    public static final java.util.Set<String> CANCEL_REASONS = java.util.Set.of("CHANGED_MIND", "SCHEDULE_CONFLICT", "ITEM_UNAVAILABLE",
            "CONDITION_MISMATCH", "COUNTERPART_UNRESPONSIVE", "OTHER");

    public OrderTransitionExecutor(ProductMapper products, OrderMapper orders,
                                   OrderEventMapper events, DomainMapper mapper,
                                   com.lulu.campusmarketbackend.mapper.InspectionMapper inspections,
                                   com.lulu.campusmarketbackend.mapper.GovernanceMapper governance,
                                   @Value("${campus-market.buyer-confirmed-expiry-hours}") int buyerConfirmedExpiryHours) {
        this.governance = governance;
        if (buyerConfirmedExpiryHours <= 0) {
            throw new IllegalStateException("campus-market.buyer-confirmed-expiry-hours 必须为正数");
        }
        this.products = products; this.orders = orders; this.events = events; this.mapper = mapper;
        this.inspections = inspections;
        this.buyerConfirmedExpiryHours = buyerConfirmedExpiryHours;
    }

    /** 状态迁移的结构化结果。刻意不携带确认码，也不携带订单实体。 */
    public enum Result { SUCCESS, WRONG_CODE, CODE_LOCKED }

    /**
     * @param result 迁移结果
     * @param order  仅 {@link Result#SUCCESS} 时非空，为接口所需的订单投影（已按 viewer 脱敏）
     */
    public record Outcome(Result result, Map<String, Object> order) {
        static Outcome success(Map<String, Object> order) { return new Outcome(Result.SUCCESS, order); }
        static Outcome wrongCode() { return new Outcome(Result.WRONG_CODE, null); }
        static Outcome codeLocked() { return new Outcome(Result.CODE_LOCKED, null); }
    }

    /** 超时订单清扫。独立事务，供 OrderService 在自身事务内或事务外调用。 */
    @Transactional
    public void sweepExpired() {
        sweep();
    }

    /**
     * 在单个事务内完成一次状态迁移。
     *
     * <p>「订单不存在 / 无权限 / 状态不允许」仍然直接抛 {@link ApiException}，
     * 由 Spring 照常回滚——这些路径本就不该留下任何写入。
     * 只有确认码错误与已锁定两种情况走正常返回，以便把计数提交。
     */
    @Transactional
    public Outcome execute(String uid, UUID oid, String to, String reason, String confirmationCode) {
        return executeInternal(uid, oid, to, reason, confirmationCode, null, null);
    }

    /** 模块 7：带结构化取消原因的迁移。reasonCode / note 只对取消有意义，由调用方完成格式校验。 */
    @Transactional
    public Outcome execute(String uid, UUID oid, String to, String reason, String confirmationCode, String reasonCode, String note) {
        return executeInternal(uid, oid, to, reason, confirmationCode, reasonCode, note);
    }

    private Outcome executeInternal(String uid, UUID oid, String to, String reason, String confirmationCode, String reasonCode, String note) {
        sweep();

        OrderEntity order = orders.selectForUpdate(oid);
        if (order == null) throw ApiException.notFound("订单不存在");
        boolean buyer = uid.equals(order.getBuyerId().toString());
        if (!buyer && !uid.equals(order.getSellerId().toString())) throw ApiException.forbidden("无权操作订单");
        // 模块 7：取消是幂等的——订单已经取消时（包括双方同时取消），重复请求返回同一结果，不重复记录
        if ("CANCELLED".equals(to) && "CANCELLED".equals(order.getStatus())) {
            return Outcome.success(mapper.order(orderRow(order), uid, orders.selectReviewRows(oid)));
        }

        // 买家可从 BUYER_CONFIRMED 取消，这是该状态唯一的非核销出口；卖家没有这条通道。
        boolean buyerCancelFromConfirmed = "CANCELLED".equals(to) && buyer && "BUYER_CONFIRMED".equals(order.getStatus());
        // DISPUTED（验货存在不一致）唯一的出口是取消：任一方都可以取消，商品随之释放；
        // 它永远不能走到买家确认或核销完成
        boolean allowed = ("CANCELLED".equals(to) && List.of("PENDING_SELLER_CONFIRM", "PENDING_MEETING", "DISPUTED").contains(order.getStatus()))
                || buyerCancelFromConfirmed
                || ("PENDING_MEETING".equals(to) && !buyer && "PENDING_SELLER_CONFIRM".equals(order.getStatus()))
                || ("BUYER_CONFIRMED".equals(to) && buyer && "PENDING_MEETING".equals(order.getStatus()))
                || ("COMPLETED".equals(to) && !buyer && "BUYER_CONFIRMED".equals(order.getStatus()));
        if (!allowed) throw ApiException.conflict("当前角色或订单状态不允许此操作");
        // 模块 7：取消阶段由服务端判定；卖家确认之后的取消必须选择结构化原因，「其他」必须写一句说明
        String phase = "CANCELLED".equals(to) ? cancellationPhase(order) : null;
        if (phase != null && !"BEFORE_SELLER_CONFIRM".equals(phase) && reasonCode == null) {
            throw ApiException.badRequest("请选择取消原因");
        }
        if ("OTHER".equals(reasonCode) && note == null) throw ApiException.badRequest("选择「其他」时请写一句说明");

        // 验货闸门（模块 3.3D）：有结构化清单的订单，必须买家已提交且没有不一致，
        // 才能买家确认；核销完成时再查一次作为纵深防御——卖家不能凭确认码绕过验货。
        // 闸门在确认码校验之前：被拦下的请求不消耗 code_attempts。
        if ("BUYER_CONFIRMED".equals(to) || "COMPLETED".equals(to)) {
            String blocked = inspectionBlock(oid);
            if (blocked != null) throw ApiException.conflict(blocked);
        }

        if ("COMPLETED".equals(to)) {
            // 已达上限：直接锁定，不再累加，正确码也不再放行
            if (order.getCodeAttempts() >= MAX_CODE_ATTEMPTS) return Outcome.codeLocked();
            // 确认码错误（含未提交确认码）：累加后正常返回，让本次事务提交计数
            if (!order.getConfirmationCode().equals(confirmationCode)) {
                orders.incrementCodeAttempts(oid, MAX_CODE_ATTEMPTS);
                return Outcome.wrongCode();
            }
        }

        String from = order.getStatus();
        if ("COMPLETED".equals(to)) event(oid, uuid(uid), from, "SELLER_CONFIRMED", null);
        order.setStatus(to);
        order.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC));
        if ("PENDING_MEETING".equals(to)) order.setExpiresAt(order.getMeetingAt().plusDays(1));
        orders.updateById(order);
        if ("CANCELLED".equals(to)) {
            products.releaseReservation(order.getProductId());
            // 与取消状态变化同一事务：一张订单至多一条（主键），执行人与阶段由服务端写入
            governance.insertCancellation(oid, governance.selectOrderSchool(oid), uuid(uid), phase, reasonCode, note);
        }
        if ("COMPLETED".equals(to)) products.markSold(order.getProductId());
        // 买家确认 / 核销说明双方已经见面：这张订单上尚未确认的爽约报告失效，不能再产生处罚
        if ("BUYER_CONFIRMED".equals(to) || "COMPLETED".equals(to)) governance.expireNoShowsBefore(oid, Integer.MAX_VALUE);
        event(oid, uuid(uid), from, to, reason);

        return Outcome.success(mapper.order(orderRow(orders.selectById(oid)), uid, orders.selectReviewRows(oid)));
    }

    /**
     * 取消所处阶段（客户端不能提交）：
     * <ul>
     *   <li>卖家确认前 → BEFORE_SELLER_CONFIRM（买家无责取消；卖家拒绝也在这里）；</li>
     *   <li>验货不一致（DISPUTED）→ INSPECTION_MISMATCH；</li>
     *   <li>当前档期已有一方手动声明「已到达」→ AFTER_ARRIVAL_REPORTED（到达是本人声明，不是定位证据）；</li>
     *   <li>双方通过改约握手确认过档期（revision ≥ 1）→ AFTER_MEETING_AGREED；</li>
     *   <li>否则（卖家接单即同意买家下单时的原始预约）→ AFTER_SELLER_CONFIRM。</li>
     * </ul>
     */
    private String cancellationPhase(OrderEntity order) {
        String status = order.getStatus();
        if ("PENDING_SELLER_CONFIRM".equals(status)) return "BEFORE_SELLER_CONFIRM";
        if ("DISPUTED".equals(status)) return "INSPECTION_MISMATCH";
        int revision = governance.selectMeetingRevision(order.getId());
        if (governance.anyArrival(order.getId(), revision)) return "AFTER_ARRIVAL_REPORTED";
        return revision > 0 ? "AFTER_MEETING_AGREED" : "AFTER_SELLER_CONFIRM";
    }

    /**
     * 验货是否阻止买家确认 / 核销。返回阻止原因，null 表示放行。
     *
     * <ul>
     *   <li>没有验货记录（模块 3 之前的旧订单）或 NOT_PROVIDED（商品没有结构化声明）：
     *       保持原流程兼容，放行；</li>
     *   <li>PENDING：买家尚未提交验货，拦下；</li>
     *   <li>NEEDS_RESOLUTION：存在不一致，拦下；</li>
     *   <li>SUBMITTED 且无不一致：放行。</li>
     * </ul>
     */
    private String inspectionBlock(UUID orderId) {
        Map<String, Object> inspection = inspections.selectInspection(orderId);
        // 与订单列表 / 流程视图同一口径（OrderActionability），这里只把机器码换成错误提示
        String code = com.lulu.campusmarketbackend.flow.OrderActionability.inspectionGate(
                inspection == null ? null : String.valueOf(inspection.get("status")));
        if (code == null) return null;
        return "INSPECTION_MISMATCH".equals(code) ? "验货不一致，不能继续确认或核销" : "请先由买家完成验货并提交";
    }

    /**
     * 超时订单的实际清扫逻辑。刻意保持为<b>未加注解的私有方法</b>：
     * {@link #execute} 与 {@link #sweepExpired} 都直接调用它，避免同类自调用导致事务注解失效。
     */
    private void sweep() {
        for (OrderEntity order : orders.selectExpiredForUpdate(buyerConfirmedExpiryHours)) {
            String from = order.getStatus();
            order.setStatus("EXPIRED");
            order.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC));
            orders.updateById(order);
            products.releaseReservation(order.getProductId());
            event(order.getId(), null, from, "EXPIRED", "预约超时自动释放");
        }
    }

    private void event(UUID orderId, UUID actorId, String from, String to, String reason) {
        OrderEventEntity event = new OrderEventEntity();
        event.setId(UUID.randomUUID());
        event.setOrderId(orderId);
        event.setActorId(actorId);
        event.setFromStatus(from);
        event.setToStatus(to);
        event.setReason(reason);
        events.insert(event);
    }

    private static Map<String, Object> orderRow(OrderEntity o) {
        return map("id", o.getId(), "product_id", o.getProductId(), "buyer_id", o.getBuyerId(),
                "seller_id", o.getSellerId(), "price", o.getPrice(), "status", o.getStatus(),
                "meeting_point_id", o.getMeetingPointId(), "meeting_at", o.getMeetingAt(),
                "contact", o.getContact(), "confirmation_code", o.getConfirmationCode(),
                "code_attempts", o.getCodeAttempts(), "expires_at", o.getExpiresAt(),
                "created_at", o.getCreatedAt(), "updated_at", o.getUpdatedAt());
    }

    private static UUID uuid(Object value) {
        try { return UUID.fromString(String.valueOf(value)); }
        catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); }
    }
}
