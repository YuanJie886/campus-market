package com.lulu.campusmarketbackend.flow;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.FlowMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 交易履历（模块 3.6）。只展示可解释的事实，<b>不生成任何信用分或靠谱指数</b>。
 *
 * <p>本人履历与公共履历是两个完全不同的投影：
 * <ul>
 *   <li>本人：全部计数 + 最近若干笔订单入口（本来就是自己的订单）；</li>
 *   <li>公共：只有聚合数字——完成次数、加入时间、对方给出的评价汇总。
 *       不含任何订单 id、商品、对方身份、具体时间、宿舍楼或联系方式。
 *       评价少于 {@value #MIN_PUBLIC_SAMPLE} 条时不展示平均分：小样本的平均数很容易被读成对某一笔交易的指认。</li>
 * </ul>
 * 公共投影在后端按白名单组装，不把完整对象发给前端再隐藏。
 */
@Service
public class TradeHistoryService {

    public static final int MIN_PUBLIC_SAMPLE = 3;
    private static final int RECENT_LIMIT = 10;

    private final FlowMapper flow;
    private final UserMapper users;

    private final com.lulu.campusmarketbackend.mapper.GovernanceMapper governance;

    public TradeHistoryService(FlowMapper flow, UserMapper users, com.lulu.campusmarketbackend.mapper.GovernanceMapper governance) {
        this.governance = governance;
        this.flow = flow;
        this.users = users;
    }

    public Map<String, Object> own(String uid) {
        UUID me = UUID.fromString(uid);
        Map<String, Object> counts = flow.selectOwnCounts(me);
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : List.of("completed", "completed_as_buyer", "completed_as_seller",
                "cancelled", "expired", "disputed", "active")) {
            result.put(camel(key), ((Number) counts.get(key)).longValue());
        }
        List<Map<String, Object>> recent = new ArrayList<>();
        for (Map<String, Object> row : flow.selectRecentOrders(me, RECENT_LIMIT)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("orderId", DomainMapper.text(row.get("id")));
            item.put("productTitle", DomainMapper.text(row.get("product_title")));
            item.put("role", me.equals(row.get("buyer_id")) ? "BUYER" : "SELLER");
            item.put("status", DomainMapper.text(row.get("status")));
            item.put("updatedAt", DomainMapper.epoch(row.get("updated_at")));
            recent.add(item);
        }
        result.put("recent", recent);
        // 模块 7：本人在确认档期之后发起的取消，只出现在本人履历里（不进入公共履历，也不计分）
        List<Map<String, Object>> cancellations = new ArrayList<>();
        for (Map<String, Object> row : governance.selectOwnCancellations(me)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("orderId", DomainMapper.text(row.get("order_id")));
            item.put("phase", DomainMapper.text(row.get("phase")));
            item.put("reasonCode", DomainMapper.nullableText(row.get("reason_code")));
            item.put("createdAt", DomainMapper.epoch(row.get("created_at")));
            cancellations.add(item);
        }
        result.put("cancellationsAfterAgreement", cancellations);
        return result;
    }

    public Map<String, Object> publicSummary(String userId) {
        UUID id;
        try {
            id = UUID.fromString(userId);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("用户不存在");
        }
        Map<String, Object> user = users.selectRowById(id);
        if (user == null) throw ApiException.notFound("用户不存在");
        Map<String, Object> counts = flow.selectPublicCounts(id);

        long reviewCount = ((Number) counts.get("review_count")).longValue();
        Object ratingSum = counts.get("rating_sum");
        BigDecimal average = reviewCount == 0 || ratingSum == null ? null
                : new BigDecimal(ratingSum.toString()).divide(BigDecimal.valueOf(reviewCount), 4, RoundingMode.HALF_UP);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("completedCount", ((Number) counts.get("completed")).longValue());
        result.put("joinedAt", DomainMapper.epoch(user.get("created_at")));
        result.put("reviewCount", reviewCount);
        result.put("averageRating", reviewCount >= MIN_PUBLIC_SAMPLE && average != null
                ? average.setScale(1, RoundingMode.HALF_UP).doubleValue()
                : null);
        return result;
    }

    private static String camel(String snake) {
        StringBuilder out = new StringBuilder();
        boolean upper = false;
        for (char c : snake.toCharArray()) {
            if (c == '_') { upper = true; continue; }
            out.append(upper ? Character.toUpperCase(c) : c);
            upper = false;
        }
        return out.toString();
    }
}
