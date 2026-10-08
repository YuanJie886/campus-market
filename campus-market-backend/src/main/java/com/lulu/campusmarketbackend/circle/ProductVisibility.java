package com.lulu.campusmarketbackend.circle;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.CircleMapper;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 6：商品可见性的 Java 侧入口。判断本身只有一个实现——V9 的 SQL 函数：
 * <ul>
 *   <li>{@code product_visible_to}：列表、搜索、feed、计数、收藏列表、需求匹配、收件箱、未读数（在各自 SQL 里调用）；</li>
 *   <li>{@code product_readable_by}：单个商品的直接访问（详情、分享链接，以及收藏 / 评论 / 会话 / 浏览数的前置检查）。</li>
 * </ul>
 * 这里不重复写一遍规则，只负责调用它们、解析请求里的 visibility / circleIds，以及在发布 / 购买时对成员资格加锁。
 */
@Component
public class ProductVisibility {

    public static final String PUBLIC = "PUBLIC";
    public static final String CIRCLE_ONLY = "CIRCLE_ONLY";
    public static final int MAX_CIRCLES = 5;

    private final CircleMapper circles;

    public ProductVisibility(CircleMapper circles) {
        this.circles = circles;
    }

    /** 请求里的可见性设置（已校验形状，未校验成员资格）。 */
    public record Choice(String visibility, List<UUID> circleIds) {
        public boolean circleOnly() { return CIRCLE_ONLY.equals(visibility); }
    }

    /**
     * 解析 visibility / circleIds。默认 PUBLIC；必须主动选择 CIRCLE_ONLY，且至少 1 个、最多 5 个不重复的圈子；
     * PUBLIC 不接受圈子列表（不会「顺手」把商品发进任何圈子）。
     */
    public static Choice parse(Object rawVisibility, Object rawCircleIds) {
        String visibility = rawVisibility == null ? PUBLIC : String.valueOf(rawVisibility);
        if (!PUBLIC.equals(visibility) && !CIRCLE_ONLY.equals(visibility)) throw ApiException.badRequest("可见范围无效");
        List<UUID> ids = new ArrayList<>();
        if (rawCircleIds != null) {
            if (!(rawCircleIds instanceof List<?> list)) throw ApiException.badRequest("circleIds 格式无效");
            Set<UUID> seen = new LinkedHashSet<>();
            for (Object v : list) {
                try {
                    if (!seen.add(UUID.fromString(String.valueOf(v)))) throw ApiException.badRequest("圈子不能重复选择");
                } catch (IllegalArgumentException e) {
                    throw ApiException.notFound("圈子不存在");
                }
            }
            ids.addAll(seen);
        }
        if (PUBLIC.equals(visibility) && !ids.isEmpty()) throw ApiException.badRequest("全校公开的商品不需要选择圈子");
        if (CIRCLE_ONLY.equals(visibility) && (ids.isEmpty() || ids.size() > MAX_CIRCLES)) {
            throw ApiException.badRequest("圈子可见需要选择 1～" + MAX_CIRCLES + " 个圈子");
        }
        return new Choice(visibility, List.copyOf(ids));
    }

    /**
     * 发布 / 编辑前：卖家必须是所有目标圈子的在籍成员，圈子在用且与商品同校。对圈子行与成员行加共享锁，
     * 并发的移除、退出、归档必须等本事务结束。不满足的一律 404（不区分「圈子不存在」与「你不在这个圈子」）。
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void requirePublishable(UUID sellerId, String campus, Choice choice) {
        if (!choice.circleOnly()) return;
        String school = circles.selectCampusSchool(campus);
        List<UUID> usable = circles.lockUsableCircles(sellerId, school, choice.circleIds());
        if (usable.size() != choice.circleIds().size()) throw ApiException.notFound("圈子不存在或你不是这个圈子的成员");
    }

    /** 写入商品与圈子的关系（先删后写；PUBLIC 只删）。与商品写入同一事务，V9 的约束触发器在提交时兜底。 */
    @Transactional(propagation = Propagation.MANDATORY)
    public void replaceLinks(UUID productId, Choice choice) {
        circles.deleteProductCircles(productId);
        if (choice.circleOnly()) circles.insertProductCircles(productId, choice.circleIds());
    }

    /** 单个商品的直接访问：不可读与不存在一样 404，不透露私密商品是否存在。 */
    public boolean readable(UUID productId, UUID viewer) {
        return Boolean.TRUE.equals(circles.selectReadable(productId, viewer));
    }

    /**
     * 下单前：圈子商品只有在籍成员能买。对买家的成员行与圈子行加共享锁——并发的「移除成员」要改这些行，
     * 必须等订单事务提交；若移除先提交，这里读到的已是 REMOVED，下单失败（404）。
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void requirePurchasable(Map<String, Object> productRow, UUID buyer) {
        String school = circles.selectCampusSchool(String.valueOf(productRow.get("campus")));
        // 6.1A：他校商品（包括 PUBLIC）与被治理隐藏的商品，对买家与不存在相同
        if (school == null || !school.equals(circles.selectUserSchool(buyer)) || productRow.get("moderation_hidden_at") != null) {
            throw ApiException.notFound("商品不存在");
        }
        if (!CIRCLE_ONLY.equals(String.valueOf(productRow.get("visibility")))) return;
        if (circles.lockBuyerAccess((UUID) productRow.get("id"), buyer, school).isEmpty()) throw ApiException.notFound("商品不存在");
    }

    public List<UUID> linkedCircles(UUID productId) {
        return circles.selectProductCircleIds(productId);
    }

    public List<UUID> usableCircleIds(UUID userId, String schoolId) {
        return circles.selectUsableCircleIds(userId, schoolId);
    }
}
