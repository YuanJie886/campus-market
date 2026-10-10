package com.lulu.campusmarketbackend.service;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static com.lulu.campusmarketbackend.service.DomainMapper.*;

@Service
public class ContactRequestService {
    private final ContactRequestMapper requests;
    private final ProductMapper products;
    private final MarketService market;
    public ContactRequestService(ContactRequestMapper requests, ProductMapper products, MarketService market) {
        this.requests=requests; this.products=products; this.market=market;
    }
    public Map<String,Object> state(String uid, String pid) {
        market.product(pid, uid);
        Map<String,Object> row=requests.find(UUID.fromString(pid),UUID.fromString(uid));
        return row == null ? null : view(row);
    }
    @Transactional
    public Map<String,Object> create(String uid, String pid) {
        // Lock the listing before checking visibility and availability, including concurrent owner edits.
        UUID productId=uuid(pid), buyer=UUID.fromString(uid);
        Map<String,Object> row=products.selectForUpdate(productId);
        if (row==null) throw ApiException.notFound("商品不存在或已下架");
        market.product(pid, uid);
        UUID seller=UUID.fromString(text(row.get("seller_id")));
        if (seller.equals(buyer)) throw ApiException.badRequest("不能申请自己的联系方式");
        if (!"在售".equals(row.get("status"))) throw ApiException.conflict("该商品当前不可申请联系");
        if (Boolean.TRUE.equals(row.get("contact_public"))) throw ApiException.conflict("卖家已公开联系方式，请直接查看");
        requests.insert(UUID.randomUUID(),productId,buyer,seller);
        return view(requests.find(productId,buyer));
    }
    public List<Map<String,Object>> list(String uid) {
        return requests.list(UUID.fromString(uid)).stream().map(this::view).toList();
    }
    @Transactional
    public Map<String,Object> decide(String uid,String id,String status) {
        if (!Set.of("APPROVED","REJECTED").contains(status)) throw ApiException.badRequest("请选择同意或拒绝");
        Map<String,Object> row=requests.lock(uuid(id));
        // Conceal existence from unrelated users; only the listing owner can decide.
        if (row==null || !uid.equals(text(row.get("seller_id")))) throw ApiException.notFound("联系申请不存在");
        market.product(text(row.get("product_id")),uid);
        String current=text(row.get("status"));
        if (!"PENDING".equals(current) && !status.equals(current)) throw ApiException.conflict("该申请已处理");
        if ("PENDING".equals(current)) requests.decide(UUID.fromString(id),status);
        return view(requests.lock(UUID.fromString(id)));
    }
    private static UUID uuid(String value) { try { return UUID.fromString(value); } catch (Exception e) { throw ApiException.badRequest("ID 格式无效"); } }
    private Map<String,Object> view(Map<String,Object> row) {
        return map("id",text(row.get("id")),"productId",text(row.get("product_id")),
            "buyerId",text(row.get("buyer_id")),"sellerId",text(row.get("seller_id")),
            "status",text(row.get("status")),"createdAt",epoch(row.get("created_at")),
            "updatedAt",epoch(row.get("updated_at")),"productTitle",text(row.get("product_title")),
            "buyerNickname",text(row.get("buyer_nickname")));
    }
}
