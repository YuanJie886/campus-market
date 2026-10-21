package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.governance.RestrictionGuard;
import com.lulu.campusmarketbackend.mapper.*;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.lulu.campusmarketbackend.service.DomainMapper.*;

/**
 * 联系申请：平台只展示商品与联系方式，买家申请、卖家同意之后，只有这一位买家看得到联系方式。
 *
 * <ul>
 *   <li>状态：PENDING → APPROVED / REJECTED（卖家）/ WITHDRAWN（买家撤回）；APPROVED → REVOKED（卖家撤回同意）；
 *       WITHDRAWN → PENDING（买家重新申请）。REJECTED 与 REVOKED 是终态，再次申请返回 409，不会静默成功；</li>
 *   <li>发起与重新申请：检查「申请联系方式」限制（历史上的「预约」限制同样生效）并按用户限流；
 *       对同一件商品已有 PENDING / APPROVED 申请时的重复请求幂等返回原申请、不计入限流——
 *       即使买家此刻处于「申请联系方式」限制中也一样（限制只拦新的申请与撤回后的重新申请）；</li>
 *   <li>不存在、看不到的商品与不属于本人的申请一律 404，不透露是否存在；</li>
 *   <li>站内未读：卖家看到新的待处理申请，买家看到同意 / 拒绝 / 撤回同意；进入列表后标记已读。</li>
 * </ul>
 */
@Service
public class ContactRequestService {
    public static final Set<String> STATUSES = Set.of("PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "REVOKED");
    private static final Set<String> LIST_QUERY = Set.of("role", "status", "page", "size");
    private static final Set<String> ROLES = Set.of("received", "sent");
    private static final String NOT_FOUND = "联系申请不存在";

    private final ContactRequestMapper requests;
    private final ProductMapper products;
    private final MarketService market;
    private final RestrictionGuard restrictions;
    private final RateLimitService rateLimit;

    public ContactRequestService(ContactRequestMapper requests, ProductMapper products, MarketService market,
                                 RestrictionGuard restrictions, RateLimitService rateLimit) {
        this.requests = requests; this.products = products; this.market = market;
        this.restrictions = restrictions; this.rateLimit = rateLimit;
    }

    public Map<String,Object> state(String uid, String pid) {
        market.product(pid, uid);
        Map<String,Object> row = requests.find(uuid(pid), UUID.fromString(uid));
        return row == null ? null : view(requests.view((UUID) row.get("id")), uid);
    }

    @Transactional
    public Map<String,Object> create(String uid, String pid, Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of());
        UUID productId = uuid(pid), buyer = UUID.fromString(uid);
        // 先对用户行取共享锁并读出限制（与「工作人员施加限制」串行化；锁顺序仍是用户行 → 商品行），
        // 但等确认这不是对已有申请的幂等重放之后才拒绝
        ApiException restricted = restrictions.check(buyer, "CONTACT");
        // 再锁商品行：与卖家并发下架 / 改为公开联系方式串行化
        Map<String,Object> row = products.selectForUpdate(productId);
        if (row == null) throw ApiException.notFound("商品不存在或已下架");
        market.product(pid, uid);
        UUID seller = UUID.fromString(text(row.get("seller_id")));
        if (seller.equals(buyer)) throw ApiException.badRequest("不能申请自己的联系方式");
        Map<String,Object> existing = requests.lockFor(productId, buyer);
        if (existing != null) {
            String status = text(existing.get("status"));
            if (Set.of("PENDING", "APPROVED").contains(status)) return view(requests.view((UUID) existing.get("id")), uid);
        }
        // 新申请与撤回后的重新申请（WITHDRAWN → PENDING）受「申请联系方式」限制
        if (restricted != null) throw restricted;
        if (existing != null) {
            String status = text(existing.get("status"));
            if ("REJECTED".equals(status)) throw ApiException.conflict("卖家已拒绝这次申请，不能再次申请");
            if ("REVOKED".equals(status)) throw ApiException.conflict("卖家已撤回同意，不能再次申请");
        }
        if (!"在售".equals(row.get("status"))) throw ApiException.conflict("该商品当前不可申请联系");
        if (Boolean.TRUE.equals(row.get("contact_public"))) throw ApiException.conflict("卖家已公开联系方式，请直接查看");
        rateLimit.consume(RateLimitService.Scope.CONTACT_REQUEST, uid);
        if (existing != null) {
            requests.reapply((UUID) existing.get("id"));
            return view(requests.view((UUID) existing.get("id")), uid);
        }
        UUID id = UUID.randomUUID();
        requests.insert(id, productId, buyer, seller);
        return view(requests.view((UUID) requests.find(productId, buyer).get("id")), uid);
    }

    public Map<String,Object> list(String uid, Map<String,String> query) {
        for (String key : query.keySet()) if (!LIST_QUERY.contains(key)) throw ApiException.badRequest("不支持的字段：" + key);
        String role = blank(query.get("role")) ? "received" : query.get("role");
        if (!ROLES.contains(role)) throw ApiException.badRequest("role 只能是 received 或 sent");
        String status = blank(query.get("status")) ? null : query.get("status");
        if (status != null && !STATUSES.contains(status)) throw ApiException.badRequest("申请状态无效");
        int page = intParam(query.get("page"), "page", 10000, 1);
        int size = intParam(query.get("size"), "size", 50, 20);
        UUID me = UUID.fromString(uid);
        boolean received = "received".equals(role);
        List<Map<String,Object>> items = new ArrayList<>();
        for (Map<String,Object> row : requests.page(me, received, status, size, (page - 1) * size)) items.add(view(row, uid));
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", requests.count(me, received, status));
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    public Map<String,Object> unread(String uid) {
        UUID me = UUID.fromString(uid);
        long received = requests.unreadReceived(me), updates = requests.unreadUpdates(me);
        return map("received", received, "updates", updates, "total", received + updates);
    }

    @Transactional
    public Map<String,Object> markRead(String uid, Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of("role"));
        Object role = body == null ? null : body.get("role");
        if (!(role instanceof String r) || !ROLES.contains(r)) throw ApiException.badRequest("role 只能是 received 或 sent");
        UUID me = UUID.fromString(uid);
        if ("received".equals(role)) requests.markReceivedSeen(me); else requests.markUpdatesSeen(me);
        return unread(uid);
    }

    @Transactional
    public Map<String,Object> decide(String uid, String id, Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of("status"));
        Object raw = body == null ? null : body.get("status");
        if (!(raw instanceof String status) || !Set.of("APPROVED", "REJECTED").contains(status)) throw ApiException.badRequest("请选择同意或拒绝");
        Map<String,Object> row = ownedBy(id, uid, "seller_id");
        market.product(text(row.get("product_id")), uid);
        String current = text(row.get("status"));
        if ("PENDING".equals(current)) requests.decide((UUID) row.get("id"), status);
        else if (!status.equals(current)) throw ApiException.conflict(conflictMessage(current));
        return view(requests.view((UUID) row.get("id")), uid);
    }

    @Transactional
    public Map<String,Object> withdraw(String uid, String id, Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of());
        Map<String,Object> row = ownedBy(id, uid, "buyer_id");
        String current = text(row.get("status"));
        if ("PENDING".equals(current)) requests.withdraw((UUID) row.get("id"));
        else if (!"WITHDRAWN".equals(current)) throw ApiException.conflict(conflictMessage(current));
        return view(requests.view((UUID) row.get("id")), uid);
    }

    @Transactional
    public Map<String,Object> revoke(String uid, String id, Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body, Set.of());
        Map<String,Object> row = ownedBy(id, uid, "seller_id");
        String current = text(row.get("status"));
        if ("APPROVED".equals(current)) requests.revoke((UUID) row.get("id"));
        else if (!"REVOKED".equals(current)) throw ApiException.conflict("只能撤回已经同意的申请");
        return view(requests.view((UUID) row.get("id")), uid);
    }

    /** 锁住申请行并确认属于本人（卖家或买家）；不属于本人与不存在同为 404。 */
    private Map<String,Object> ownedBy(String id, String uid, String column) {
        Map<String,Object> row = requests.lock(uuid(id));
        if (row == null || !uid.equals(text(row.get(column)))) throw ApiException.notFound(NOT_FOUND);
        return row;
    }

    private static String conflictMessage(String current) {
        return switch (current) {
            case "WITHDRAWN" -> "买家已撤回这次申请";
            case "REVOKED" -> "卖家已撤回同意";
            default -> "该申请已处理";
        };
    }

    private static UUID uuid(String value) { try { return UUID.fromString(value); } catch (Exception e) { throw ApiException.notFound(NOT_FOUND); } }
    private static boolean blank(String s) { return s == null || s.isBlank(); }
    private static int intParam(String raw, String name, int max, int fallback) {
        if (blank(raw)) return fallback;
        try {
            int n = Integer.parseInt(raw.trim());
            if (n < 1 || n > max) throw new NumberFormatException();
            return n;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(name + " 无效");
        }
    }

    /** 对卖家：新的待处理申请未读；对买家：新的结果（同意 / 拒绝 / 撤回同意）未读。不含任何联系方式。 */
    private Map<String,Object> view(Map<String,Object> row, String uid) {
        boolean asSeller = uid.equals(text(row.get("seller_id")));
        String status = text(row.get("status"));
        boolean unread = asSeller ? "PENDING".equals(status) && row.get("seller_seen_at") == null
                : Set.of("APPROVED", "REJECTED", "REVOKED").contains(status) && row.get("buyer_seen_at") == null;
        Map<String,Object> m = map("id", text(row.get("id")), "productId", text(row.get("product_id")),
            "buyerId", text(row.get("buyer_id")), "sellerId", text(row.get("seller_id")),
            "status", status, "createdAt", epoch(row.get("created_at")),
            "updatedAt", epoch(row.get("updated_at")), "productTitle", text(row.get("product_title")),
            "buyerNickname", text(row.get("buyer_nickname")), "sellerNickname", text(row.get("seller_nickname")));
        m.put("decidedAt", row.get("decided_at") == null ? null : epoch(row.get("decided_at")));
        m.put("unread", unread);
        return m;
    }
}
