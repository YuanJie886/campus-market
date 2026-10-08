package com.lulu.campusmarketbackend.demand;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 需求匹配评分——后端<b>唯一</b>的评分规则。
 *
 * <p>只有通过全部硬性条件（学校、范围、分类、价格、关键词）的订阅才会进入这里。
 * 评分只决定「有多像」，不决定「是否匹配」。
 *
 * <p>规则刻意简单、可解释：每个理由码对应一个固定分值，总分是理由分值之和，
 * 上限 100。用户看到的「匹配理由」与分数之间没有任何隐藏项。
 *
 * <table>
 *   <tr><th>理由码</th><th>分值</th><th>条件</th></tr>
 *   <tr><td>TEXTBOOK_EXACT</td><td>50</td><td>精确教材版本订阅，商品关联的正是这个版本（模块 4）</td></tr>
 *   <tr><td>KEYWORD_TITLE_EXACT</td><td>50</td><td>规范化标题与关键词完全相同</td></tr>
 *   <tr><td>KEYWORD_TITLE</td><td>40</td><td>标题包含关键词（非完全相同）</td></tr>
 *   <tr><td>KEYWORD_DESCRIPTION</td><td>20</td><td>仅描述包含关键词</td></tr>
 *   <tr><td>CATEGORY</td><td>20</td><td>订阅指定了分类且命中</td></tr>
 *   <tr><td>SAME_BUILDING</td><td>20</td><td>商品在订阅锚点楼栋</td></tr>
 *   <tr><td>SAME_ZONE</td><td>12</td><td>商品在锚点楼栋所在园区（非同楼）</td></tr>
 *   <tr><td>SAME_CAMPUS</td><td>6</td><td>校区范围订阅命中本校区</td></tr>
 *   <tr><td>PRICE_CLOSE</td><td>10</td><td>订阅给了价格上下限，且价格落在区间中间一半</td></tr>
 * </table>
 *
 * <p>TEXTBOOK_EXACT 与三个关键词理由互斥（教材版本订阅不带关键词，由数据库约束保证），
 * 三个地理理由互斥，因此最高分仍为 50+20+20+10 = 100。TEXTBOOK_EXACT 是版本 id 的精确相等，
 * 不是书名相似度；它排在理由列表第一位，作为最高优先的理由。
 * 前端 Mock 的 scoreDemandMatch 与此逐条一致。
 */
public final class DemandScorer {

    public static final int MAX_SCORE = 100;

    /** 「高匹配」档位的下限。档位只由这里决定，前端只负责把档位映射成文字与样式。 */
    public static final int HIGH_TIER_MIN_SCORE = 60;

    /** 展示档位：HIGH / NORMAL。客户端不得自行由分数推导。 */
    public static String tier(int score) {
        return score >= HIGH_TIER_MIN_SCORE ? "HIGH" : "NORMAL";
    }

    private DemandScorer() {}

    /** 进入评分的订阅条件。 */
    public record Subscription(String normalizedKeyword, String category,
                               BigDecimal minPrice, BigDecimal maxPrice,
                               String geoScope, String campusId, String buildingId, String anchorZone,
                               String textbookEditionId) {
        /** 普通订阅（没有教材版本）。 */
        public Subscription(String normalizedKeyword, String category, BigDecimal minPrice, BigDecimal maxPrice,
                            String geoScope, String campusId, String buildingId, String anchorZone) {
            this(normalizedKeyword, category, minPrice, maxPrice, geoScope, campusId, buildingId, anchorZone, null);
        }
    }

    /** 被评分的商品。标题与描述须已用 {@link DemandText#normalize} 规范化。 */
    public record Product(String normalizedTitle, String normalizedDescription, String category,
                          BigDecimal price, String campus, String buildingId, String zone,
                          String textbookEditionId) {
        /** 未关联教材版本的商品。 */
        public Product(String normalizedTitle, String normalizedDescription, String category,
                       BigDecimal price, String campus, String buildingId, String zone) {
            this(normalizedTitle, normalizedDescription, category, price, campus, buildingId, zone, null);
        }
    }

    public record Score(int value, List<String> reasonCodes) {}

    public static Score score(Subscription s, Product p) {
        int total = 0;
        List<String> reasons = new ArrayList<>();

        if (s.textbookEditionId() != null && s.textbookEditionId().equals(p.textbookEditionId())) {
            total += 50; reasons.add("TEXTBOOK_EXACT");
        }

        if (s.normalizedKeyword() != null) {
            if (s.normalizedKeyword().equals(p.normalizedTitle())) {
                total += 50; reasons.add("KEYWORD_TITLE_EXACT");
            } else if (DemandText.contains(p.normalizedTitle(), s.normalizedKeyword())) {
                total += 40; reasons.add("KEYWORD_TITLE");
            } else if (DemandText.contains(p.normalizedDescription(), s.normalizedKeyword())) {
                total += 20; reasons.add("KEYWORD_DESCRIPTION");
            }
        }

        if (s.category() != null && s.category().equals(p.category())) {
            total += 20; reasons.add("CATEGORY");
        }

        switch (s.geoScope()) {
            case "BUILDING", "ZONE" -> {
                if (s.buildingId() != null && s.buildingId().equals(p.buildingId())) {
                    total += 20; reasons.add("SAME_BUILDING");
                } else if (s.anchorZone() != null && s.anchorZone().equals(p.zone())
                        && s.campusId() != null && s.campusId().equals(p.campus())) {
                    total += 12; reasons.add("SAME_ZONE");
                }
            }
            case "CAMPUS" -> {
                if (s.campusId() != null && s.campusId().equals(p.campus())) {
                    total += 6; reasons.add("SAME_CAMPUS");
                }
            }
            default -> { /* SCHOOL：没有地理锚点，不加分 */ }
        }

        if (s.minPrice() != null && s.maxPrice() != null && p.price() != null
                && s.maxPrice().compareTo(s.minPrice()) > 0) {
            BigDecimal center = s.minPrice().add(s.maxPrice()).divide(BigDecimal.valueOf(2));
            BigDecimal quarter = s.maxPrice().subtract(s.minPrice()).divide(BigDecimal.valueOf(4));
            if (p.price().subtract(center).abs().compareTo(quarter) <= 0) {
                total += 10; reasons.add("PRICE_CLOSE");
            }
        }

        return new Score(Math.min(total, MAX_SCORE), List.copyOf(reasons));
    }
}
