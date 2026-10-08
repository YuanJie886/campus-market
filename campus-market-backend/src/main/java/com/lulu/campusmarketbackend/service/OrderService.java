package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.entity.OrderEntity;
import com.lulu.campusmarketbackend.entity.OrderEventEntity;
import com.lulu.campusmarketbackend.entity.ProductEntity;
import com.lulu.campusmarketbackend.entity.ReviewEntity;
import com.lulu.campusmarketbackend.mapper.*;
import com.lulu.campusmarketbackend.security.AuthService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class OrderService {
    private static final List<String> TRANSITIONS = List.of("PENDING_MEETING", "BUYER_CONFIRMED", "COMPLETED", "CANCELLED");
    /**
     * 创建订单允许出现的请求体字段白名单。
     * 买卖双方身份一律由服务端从认证信息推导，任何身份字段（buyerId / sellerId / __buyerId 等）
     * 都必须作为未知字段被拒绝，不得从请求体读取。
     * idempotencyKey 列在此处是因为 CampusMarketController 会把 Idempotency-Key 请求头
     * 合并进同一个 map 后再交给本方法。
     */
    private static final Set<String> CREATE_ORDER_FIELDS =
            Set.of("productId", "meetingPointId", "meetingAtIso", "meetingEndsAtIso", "contact", "idempotencyKey");
    /** 7.1A：未提交结束时间时使用的默认时长（下单页与接单页都明确展示）；时长范围与改约一致。 */
    public static final int DEFAULT_SLOT_MINUTES = 60;
    public static final int MIN_SLOT_MINUTES = 15;
    public static final int MAX_SLOT_MINUTES = 120;
    /** 状态迁移允许的字段。buyerId / sellerId / codeAttempts / status 等一律拒绝。 */
    private static final Set<String> TRANSITION_FIELDS = Set.of("to", "reason", "confirmationCode", "reasonCode", "note");
    /** 评价允许的字段。reviewerId / orderId / status 等一律拒绝。 */
    private static final Set<String> REVIEW_FIELDS = Set.of("rating", "comment");
    private final UserMapper users;
    private final ProductMapper products;
    private final OrderMapper orders;
    private final OrderEventMapper events;
    private final ReviewMapper reviews;
    private final ReferenceMapper references;
    private final DomainMapper mapper;
    private final SecureRandom random = new SecureRandom();

    private final OrderTransitionExecutor transitions;
    private final RateLimitService rateLimit;
    private final com.lulu.campusmarketbackend.inspection.InspectionService inspections;
    private final com.lulu.campusmarketbackend.circle.ProductVisibility visibility;

    private final com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions;

    public OrderService(UserMapper users, ProductMapper products, OrderMapper orders, OrderEventMapper events, ReviewMapper reviews, ReferenceMapper references, DomainMapper mapper, OrderTransitionExecutor transitions, RateLimitService rateLimit, com.lulu.campusmarketbackend.inspection.InspectionService inspections, com.lulu.campusmarketbackend.circle.ProductVisibility visibility, com.lulu.campusmarketbackend.governance.RestrictionGuard restrictions) {
        this.visibility = visibility;
        this.restrictions = restrictions;
        this.users = users; this.products = products; this.orders = orders; this.events = events; this.reviews = reviews; this.references = references; this.mapper = mapper; this.transitions = transitions; this.rateLimit = rateLimit; this.inspections = inspections;
    }

    /** 超时清扫的实现已下沉到 OrderTransitionExecutor，此处保留入口以维持既有调用点语义。 */
    public void expire() { transitions.sweepExpired(); }

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        rejectUnknownFields(body);
        // 买家身份只能来自认证结果，绝不接受请求体覆盖。
        UUID buyerId = uuid(uid), productId = uuid(body.get("productId"));
        String meetingPointId = AuthService.string(body, "meetingPointId", 1, 100), meetingAtIso = AuthService.string(body, "meetingAtIso", 1, 80), contact = AuthService.string(body, "contact", 1, 100), idempotencyKey = AuthService.string(body, "idempotencyKey", 1, 100);
        OffsetDateTime meetingAt; try { meetingAt = OffsetDateTime.parse(meetingAtIso); } catch (Exception e) { throw ApiException.badRequest("面交时间格式无效"); }
        OffsetDateTime meetingEndsAt = slotEnd(body.get("meetingEndsAtIso"), meetingAt);
        // 旧客户端不提交结束时间时，指纹与此前一致；提交了就把结束时间纳入指纹（同一幂等键不能换档期）
        String fingerprint = hash(productId + "|" + meetingPointId + "|" + meetingAtIso + "|" + contact + "|" + idempotencyKey
                + (body.get("meetingEndsAtIso") == null ? "" : "|" + meetingEndsAt.toInstant())); expire(); users.lockById(buyerId); restrictions.require(buyerId, "BOOKING");
        List<Map<String, Object>> duplicates = orders.selectByIdempotency(buyerId, idempotencyKey); if (!duplicates.isEmpty()) { Map<String, Object> duplicate = duplicates.get(0); if (!fingerprint.equals(text(duplicate.get("request_hash")))) throw ApiException.conflict("幂等键不能用于不同预约"); return orderView(uid, uuid(duplicate.get("id"))); }
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC); if (!meetingAt.isAfter(now.plusMinutes(1)) || meetingAt.isAfter(now.plusDays(30))) throw ApiException.badRequest("请选择一分钟后至 30 天内的面交时间");
        Map<String, Object> product = products.selectForUpdate(productId); if (product == null) throw ApiException.notFound("商品不存在"); UUID sellerId = uuid(product.get("seller_id")); String productCampus = text(product.get("campus")); if (sellerId.toString().equals(uid)) throw ApiException.forbidden("不能预约自己的商品");
        // 模块 6：圈子商品只有在籍成员能买（与商品不存在同一个 404）。对买家的成员行加共享锁，并发的移除必须等这里提交
        visibility.requirePurchasable(product, buyerId);
        if (!"在售".equals(product.get("status"))) throw ApiException.conflict("商品已被预约或不可购买");
        if (references.countMeetingPoint(meetingPointId, productCampus) == 0) throw ApiException.badRequest("请选择商品所在校区的公共交易点"); String buyerCampus = users.selectCampus(buyerId); if (references.countSchools(buyerCampus, productCampus) != 1) throw ApiException.forbidden("仅支持同校交易");
        OrderEntity order = new OrderEntity(); order.setId(UUID.randomUUID()); order.setProductId(productId); order.setBuyerId(buyerId); order.setSellerId(sellerId); order.setPrice((BigDecimal) product.get("price")); order.setPriceSnapshot((BigDecimal) product.get("price")); order.setCurrency("CNY"); freezeDimensions(order, productId); order.setVisibilitySnapshot(product.get("visibility") == null ? "PUBLIC" : text(product.get("visibility"))); order.setStatus("PENDING_SELLER_CONFIRM"); order.setMeetingPointId(meetingPointId); order.setMeetingAt(meetingAt); order.setMeetingEndsAt(meetingEndsAt); order.setContact(contact); order.setConfirmationCode(String.format("%06d", random.nextInt(1_000_000))); order.setCodeAttempts(0); order.setIdempotencyKey(idempotencyKey); order.setRequestHash(fingerprint); order.setExpiresAt(meetingAt.isBefore(now.plusDays(1)) ? meetingAt : now.plusDays(1));
        orders.insert(order);
        // 验货快照与订单同事务写入：快照失败则订单一并回滚；幂等重放在上面已提前返回，不会重复生成
        inspections.snapshotForOrder(order.getId(), productId);
        ProductEntity lock = new ProductEntity(); lock.setId(productId); lock.setStatus("预约中"); products.updateById(lock); event(order.getId(), buyerId, null, "PENDING_SELLER_CONFIRM", null); return orderView(uid, order.getId());
    }

    /**
     * 7.1A：档期结束时间。提交了就校验（晚于开始、时长 15～120 分钟）；没提交用默认 60 分钟，
     * 在下单时就明确写入订单并返回给双方——之后不再推断任何结束时间。
     */
    static OffsetDateTime slotEnd(Object raw, OffsetDateTime starts) {
        if (raw == null) return starts.plusMinutes(DEFAULT_SLOT_MINUTES);
        if (!(raw instanceof String s) || s.isBlank() || s.length() > 80) throw ApiException.badRequest("结束时间格式无效");
        OffsetDateTime ends;
        try { ends = OffsetDateTime.parse(s); } catch (Exception e) { throw ApiException.badRequest("结束时间格式无效"); }
        long minutes = java.time.Duration.between(starts, ends).toMinutes();
        if (!ends.isAfter(starts)) throw ApiException.badRequest("结束时间必须晚于开始时间");
        if (minutes < MIN_SLOT_MINUTES || minutes > MAX_SLOT_MINUTES) throw ApiException.badRequest("单次面交时长应为 15～120 分钟");
        return ends;
    }

    /** V8：统计维度与成交价同一事务、同一时刻写入；客户端提交的任何同名字段早已被 rejectUnknownFields 拒绝。 */
    private void freezeDimensions(OrderEntity order, UUID productId) {
        Map<String, Object> d = references.selectTradeDimensions(productId);
        if (d == null) throw ApiException.notFound("商品不存在");
        order.setSchoolIdSnapshot(text(d.get("school_id")));
        order.setCategorySnapshot(text(d.get("category")));
        order.setConditionSnapshot(text(d.get("condition")));
        order.setListingKindSnapshot(text(d.get("listing_kind")));
        order.setTextbookEditionIdSnapshot(d.get("textbook_edition_id") == null ? null : text(d.get("textbook_edition_id")));
    }

    @Transactional
    public List<Map<String, Object>> list(String uid, String role) {
        expire(); if (!List.of("all", "buyer", "seller").contains(role)) throw ApiException.badRequest("订单角色无效");
        List<Map<String, Object>> rows = orders.selectRowsByRole(uuid(uid), role);
        return project(rows, uid);
    }

    /**
     * 列表投影：评价一次批量取回，流程摘要来自同一条列表 SQL。
     * 语句数与订单数量无关（3.8A：1 笔与 100 笔都是常数条）。
     */
    private List<Map<String, Object>> project(List<Map<String, Object>> rows, String uid) {
        if (rows.isEmpty()) return List.of();
        Map<Object, List<Map<String, Object>>> reviewsByOrder = new java.util.HashMap<>();
        for (Map<String, Object> review : orders.selectReviewRowsForOrders(rows.stream().map(r -> uuid(r.get("id"))).toList())) {
            reviewsByOrder.computeIfAbsent(text(review.get("order_id")), k -> new ArrayList<>()).add(review);
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> order = mapper.order(row, uid, reviewsByOrder.getOrDefault(text(row.get("id")), List.of()));
            order.put("flow", com.lulu.campusmarketbackend.flow.OrderActionability.summary(
                    text(row.get("status")),
                    row.get("summary_inspection_status") == null ? null : text(row.get("summary_inspection_status")),
                    Boolean.TRUE.equals(row.get("summary_has_pending_proposal")),
                    row.get("summary_my_presence") == null ? null : text(row.get("summary_my_presence")),
                    row.get("summary_counterpart_presence") == null ? null : text(row.get("summary_counterpart_presence"))));
            result.add(order);
        }
        return result;
    }

    /** 单个订单的对外投影（下单、迁移的返回值），与列表同一结构，带流程摘要。 */
    private Map<String, Object> orderView(String uid, UUID orderId) {
        Map<String, Object> row = orders.selectRowWithSummary(orderId, uuid(uid));
        if (row == null) throw ApiException.notFound("订单不存在");
        return project(List.of(row), uid).get(0);
    }

    /**
     * 订单状态迁移的 HTTP 入口。
     *
     * <p>本方法<b>刻意不带 {@code @Transactional}</b>：确认码错误时，计数必须随
     * {@link OrderTransitionExecutor#execute} 的事务提交，而 HTTP 错误必须在该事务
     * 提交之后才抛出。若入口本身带事务，抛出的 {@code ApiException}（继承自
     * {@code RuntimeException}）会把已提交范围内的计数一并回滚——这正是 R-02 的成因。
     */
    public Map<String, Object> transition(String uid, String orderId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, TRANSITION_FIELDS);
        String to = text(body.get("to")); if (!TRANSITIONS.contains(to)) throw ApiException.badRequest("订单状态无效");
        String reason = body.get("reason") == null ? null : AuthService.string(body, "reason", 0, 500);
        String confirmationCode = body.get("confirmationCode") == null ? null : text(body.get("confirmationCode"));
        // 缺失 / null / 空白 / 非 6 位数字都在进入事务前拒绝，因此不会消耗 code_attempts；
        // 只有「格式合法但内容错误」的六位数字才会进入执行器并计数。
        if ("COMPLETED".equals(to) && (confirmationCode == null || confirmationCode.isBlank())) throw ApiException.badRequest("请提供 6 位确认码");
        if (confirmationCode != null && !confirmationCode.matches("\\d{6}")) throw ApiException.badRequest("确认码格式无效");
        // 格式校验通过后、进入订单事务之前按认证用户限流。
        // 这里只用 uid 作主体，不读订单，因此不会泄露订单是否存在。
        if ("COMPLETED".equals(to)) rateLimit.consume(RateLimitService.Scope.ORDER_CONFIRMATION_CODE, uid);

        // 超时清扫由 execute 在同一事务内完成，与原实现的 expire(); selectForUpdate(...) 顺序一致。
        // 模块 7：取消的结构化原因与说明（说明最多 200 字、不含尖括号）；只对取消有意义
        String reasonCode = body.get("reasonCode") == null ? null : text(body.get("reasonCode"));
        if (reasonCode != null && (!"CANCELLED".equals(to) || !OrderTransitionExecutor.CANCEL_REASONS.contains(reasonCode))) {
            throw ApiException.badRequest("取消原因无效");
        }
        String note = body.get("note") == null ? null : AuthService.string(body, "note", 1, 200);
        if (note != null && (!"CANCELLED".equals(to) || note.matches("(?s).*[<>].*"))) throw ApiException.badRequest("说明格式无效");
        OrderTransitionExecutor.Outcome outcome = transitions.execute(uid, uuid(orderId), to, reason, confirmationCode, reasonCode, note);

        // 此处事务已提交：错误计数已落库，再抛 HTTP 异常不会回滚它。
        switch (outcome.result()) {
            case SUCCESS -> { return orderView(uid, uuid(orderId)); }
            case WRONG_CODE -> throw ApiException.badRequest("确认码错误，请重新输入");
            case CODE_LOCKED -> throw ApiException.conflict("确认码错误次数已达上限，请联系运营人员处理");
        }
        throw new IllegalStateException("未覆盖的迁移结果：" + outcome.result());
    }

    @Transactional
    public Map<String, Object> review(String uid, String orderId, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, REVIEW_FIELDS);
        int rating; try { rating = ((Number) body.get("rating")).intValue(); } catch (Exception e) { throw ApiException.badRequest("评分无效"); } if (rating < 1 || rating > 5) throw ApiException.badRequest("评分无效"); String comment = AuthService.string(body, "comment", 1, 1000); OrderEntity order = orders.selectForUpdate(uuid(orderId)); if (order == null || (!uid.equals(order.getBuyerId().toString()) && !uid.equals(order.getSellerId().toString()))) throw ApiException.forbidden("无权评价"); if (!"COMPLETED".equals(order.getStatus())) throw ApiException.conflict("完成交易后才能评价");
        ReviewEntity review = new ReviewEntity(); review.setId(UUID.randomUUID()); review.setOrderId(order.getId()); review.setReviewerId(uuid(uid)); review.setRating(rating); review.setComment(comment); try { reviews.insert(review); } catch (org.springframework.dao.DuplicateKeyException e) { throw ApiException.conflict("每笔交易只能评价一次"); } return mapper.review(reviewRow(reviews.selectById(review.getId())));
    }

    /**
     * 拒绝创建订单请求体中的任何未知字段。
     * 字段名先排序再拼接，保证同一组非法字段每次产生一致的错误信息；只回显字段名，不回显字段值。
     */
    private static void rejectUnknownFields(Map<String, Object> body) {
        List<String> unknown = body.keySet().stream().filter(key -> !CREATE_ORDER_FIELDS.contains(key)).sorted().toList();
        if (!unknown.isEmpty()) throw ApiException.badRequest("请求包含不支持的字段：" + String.join("、", unknown));
    }

    private void event(UUID orderId, UUID actorId, String from, String to, String reason) { OrderEventEntity event = new OrderEventEntity(); event.setId(UUID.randomUUID()); event.setOrderId(orderId); event.setActorId(actorId); event.setFromStatus(from); event.setToStatus(to); event.setReason(reason); events.insert(event); }
    private Map<String, Object> reviewRow(com.lulu.campusmarketbackend.entity.ReviewEntity r) { return map("rating", r.getRating(), "comment", r.getComment(), "created_at", r.getCreatedAt()); }
    private static UUID uuid(Object value) { try { return UUID.fromString(String.valueOf(value)); } catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); } }
    private static String hash(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
}
