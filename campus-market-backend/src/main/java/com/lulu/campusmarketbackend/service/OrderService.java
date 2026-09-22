package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.entity.OrderEntity;
import com.lulu.campusmarketbackend.entity.OrderEventEntity;
import com.lulu.campusmarketbackend.entity.ProductEntity;
import com.lulu.campusmarketbackend.entity.ReviewEntity;
import com.lulu.campusmarketbackend.mapper.*;
import com.lulu.campusmarketbackend.security.AuthService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class OrderService {
    private static final List<String> TRANSITIONS = List.of("PENDING_MEETING", "BUYER_CONFIRMED", "COMPLETED", "CANCELLED");
    private final UserMapper users;
    private final ProductMapper products;
    private final OrderMapper orders;
    private final OrderEventMapper events;
    private final ReviewMapper reviews;
    private final ReferenceMapper references;
    private final DomainMapper mapper;
    private final SecureRandom random = new SecureRandom();
    private final boolean expiryJobEnabled;

    public OrderService(UserMapper users, ProductMapper products, OrderMapper orders, OrderEventMapper events, ReviewMapper reviews, ReferenceMapper references, DomainMapper mapper, @Value("${campus-market.expiry-job-enabled:true}") boolean expiryJobEnabled) {
        this.users = users; this.products = products; this.orders = orders; this.events = events; this.reviews = reviews; this.references = references; this.mapper = mapper; this.expiryJobEnabled = expiryJobEnabled;
    }

    @Scheduled(fixedDelay = 60_000)
    @Transactional
    public void scheduledExpire() { if (expiryJobEnabled) expire(); }

    @Transactional
    public void expire() {
        for (OrderEntity order : orders.selectExpiredForUpdate()) {
            String from = order.getStatus(); order.setStatus("EXPIRED"); order.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC)); orders.updateById(order); products.releaseReservation(order.getProductId()); event(order.getId(), null, from, "EXPIRED", "预约超时自动释放");
        }
    }

    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        UUID buyerId = uuid(body.getOrDefault("__buyerId", uid)), productId = uuid(body.get("productId"));
        String meetingPointId = AuthService.string(body, "meetingPointId", 1, 100), meetingAtIso = AuthService.string(body, "meetingAtIso", 1, 80), contact = AuthService.string(body, "contact", 1, 100), idempotencyKey = AuthService.string(body, "idempotencyKey", 1, 100);
        OffsetDateTime meetingAt; try { meetingAt = OffsetDateTime.parse(meetingAtIso); } catch (Exception e) { throw ApiException.badRequest("面交时间格式无效"); }
        String fingerprint = hash(productId + "|" + meetingPointId + "|" + meetingAtIso + "|" + contact + "|" + idempotencyKey); expire(); users.lockById(buyerId);
        List<Map<String, Object>> duplicates = orders.selectByIdempotency(buyerId, idempotencyKey); if (!duplicates.isEmpty()) { Map<String, Object> duplicate = duplicates.get(0); if (!fingerprint.equals(text(duplicate.get("request_hash")))) throw ApiException.conflict("幂等键不能用于不同预约"); return mapper.order(duplicate, uid, orders.selectReviewRows(uuid(duplicate.get("id")))); }
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC); if (!meetingAt.isAfter(now.plusMinutes(1)) || meetingAt.isAfter(now.plusDays(30))) throw ApiException.badRequest("请选择一分钟后至 30 天内的面交时间");
        Map<String, Object> product = products.selectForUpdate(productId); if (product == null) throw ApiException.notFound("商品不存在"); UUID sellerId = uuid(product.get("seller_id")); String productCampus = text(product.get("campus")); if (sellerId.toString().equals(uid)) throw ApiException.forbidden("不能预约自己的商品"); if (!"在售".equals(product.get("status"))) throw ApiException.conflict("商品已被预约或不可购买");
        if (references.countMeetingPoint(meetingPointId, productCampus) == 0) throw ApiException.badRequest("请选择商品所在校区的公共交易点"); String buyerCampus = users.selectCampus(buyerId); if (references.countSchools(buyerCampus, productCampus) != 1) throw ApiException.forbidden("仅支持同校交易");
        OrderEntity order = new OrderEntity(); order.setId(UUID.randomUUID()); order.setProductId(productId); order.setBuyerId(buyerId); order.setSellerId(sellerId); order.setPrice((BigDecimal) product.get("price")); order.setStatus("PENDING_SELLER_CONFIRM"); order.setMeetingPointId(meetingPointId); order.setMeetingAt(meetingAt); order.setContact(contact); order.setConfirmationCode(String.format("%06d", random.nextInt(1_000_000))); order.setCodeAttempts(0); order.setIdempotencyKey(idempotencyKey); order.setRequestHash(fingerprint); order.setExpiresAt(meetingAt.isBefore(now.plusDays(1)) ? meetingAt : now.plusDays(1));
        orders.insert(order); ProductEntity lock = new ProductEntity(); lock.setId(productId); lock.setStatus("预约中"); products.updateById(lock); event(order.getId(), buyerId, null, "PENDING_SELLER_CONFIRM", null); return mapper.order(orderRow(orders.selectById(order.getId())), uid, List.of());
    }

    @Transactional
    public List<Map<String, Object>> list(String uid, String role) {
        expire(); if (!List.of("all", "buyer", "seller").contains(role)) throw ApiException.badRequest("订单角色无效"); List<Map<String, Object>> rows = orders.selectRowsByRole(uuid(uid), role); List<Map<String, Object>> result = new ArrayList<>(); for (Map<String, Object> row : rows) result.add(mapper.order(row, uid, orders.selectReviewRows(uuid(row.get("id"))))); return result;
    }

    @Transactional
    public Map<String, Object> transition(String uid, String orderId, Map<String, Object> body) {
        String to = text(body.get("to")); if (!TRANSITIONS.contains(to)) throw ApiException.badRequest("订单状态无效"); String reason = body.get("reason") == null ? null : AuthService.string(body, "reason", 0, 500); String confirmationCode = body.get("confirmationCode") == null ? null : text(body.get("confirmationCode")); if (confirmationCode != null && !confirmationCode.matches("\\d{6}")) throw ApiException.badRequest("确认码格式无效");
        expire(); UUID oid = uuid(orderId); OrderEntity order = orders.selectForUpdate(oid); if (order == null) throw ApiException.notFound("订单不存在"); boolean buyer = uid.equals(order.getBuyerId().toString()); if (!buyer && !uid.equals(order.getSellerId().toString())) throw ApiException.forbidden("无权操作订单");
        boolean allowed = ("CANCELLED".equals(to) && List.of("PENDING_SELLER_CONFIRM", "PENDING_MEETING").contains(order.getStatus())) || ("PENDING_MEETING".equals(to) && !buyer && "PENDING_SELLER_CONFIRM".equals(order.getStatus())) || ("BUYER_CONFIRMED".equals(to) && buyer && "PENDING_MEETING".equals(order.getStatus())) || ("COMPLETED".equals(to) && !buyer && "BUYER_CONFIRMED".equals(order.getStatus())); if (!allowed) throw ApiException.conflict("当前角色或订单状态不允许此操作");
        if ("COMPLETED".equals(to) && (order.getCodeAttempts() >= 5 || !order.getConfirmationCode().equals(confirmationCode))) { orders.incrementCodeAttempts(oid); throw ApiException.badRequest("确认码错误或已达 5 次上限，请联系运营人员处理"); }
        String from = order.getStatus(); if ("COMPLETED".equals(to)) event(oid, uuid(uid), from, "SELLER_CONFIRMED", null); order.setStatus(to); order.setUpdatedAt(OffsetDateTime.now(ZoneOffset.UTC)); if ("PENDING_MEETING".equals(to)) order.setExpiresAt(order.getMeetingAt().plusDays(1)); orders.updateById(order); if ("CANCELLED".equals(to)) products.releaseReservation(order.getProductId()); if ("COMPLETED".equals(to)) products.markSold(order.getProductId()); event(oid, uuid(uid), from, to, reason); return mapper.order(orderRow(orders.selectById(oid)), uid, orders.selectReviewRows(oid));
    }

    @Transactional
    public Map<String, Object> review(String uid, String orderId, Map<String, Object> body) {
        int rating; try { rating = ((Number) body.get("rating")).intValue(); } catch (Exception e) { throw ApiException.badRequest("评分无效"); } if (rating < 1 || rating > 5) throw ApiException.badRequest("评分无效"); String comment = AuthService.string(body, "comment", 1, 1000); OrderEntity order = orders.selectForUpdate(uuid(orderId)); if (order == null || (!uid.equals(order.getBuyerId().toString()) && !uid.equals(order.getSellerId().toString()))) throw ApiException.forbidden("无权评价"); if (!"COMPLETED".equals(order.getStatus())) throw ApiException.conflict("完成交易后才能评价");
        ReviewEntity review = new ReviewEntity(); review.setId(UUID.randomUUID()); review.setOrderId(order.getId()); review.setReviewerId(uuid(uid)); review.setRating(rating); review.setComment(comment); try { reviews.insert(review); } catch (org.springframework.dao.DuplicateKeyException e) { throw ApiException.conflict("每笔交易只能评价一次"); } return mapper.review(reviewRow(reviews.selectById(review.getId())));
    }

    private void event(UUID orderId, UUID actorId, String from, String to, String reason) { OrderEventEntity event = new OrderEventEntity(); event.setId(UUID.randomUUID()); event.setOrderId(orderId); event.setActorId(actorId); event.setFromStatus(from); event.setToStatus(to); event.setReason(reason); events.insert(event); }
    private Map<String, Object> orderRow(OrderEntity o) { return map("id", o.getId(), "product_id", o.getProductId(), "buyer_id", o.getBuyerId(), "seller_id", o.getSellerId(), "price", o.getPrice(), "status", o.getStatus(), "meeting_point_id", o.getMeetingPointId(), "meeting_at", o.getMeetingAt(), "contact", o.getContact(), "confirmation_code", o.getConfirmationCode(), "code_attempts", o.getCodeAttempts(), "expires_at", o.getExpiresAt(), "created_at", o.getCreatedAt(), "updated_at", o.getUpdatedAt()); }
    private Map<String, Object> reviewRow(com.lulu.campusmarketbackend.entity.ReviewEntity r) { return map("rating", r.getRating(), "comment", r.getComment(), "created_at", r.getCreatedAt()); }
    private static UUID uuid(Object value) { try { return UUID.fromString(String.valueOf(value)); } catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); } }
    private static String hash(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
}
