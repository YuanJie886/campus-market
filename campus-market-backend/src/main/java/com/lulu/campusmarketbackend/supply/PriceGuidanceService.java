package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.DemandMapper;
import com.lulu.campusmarketbackend.mapper.SupplyMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 历史成交价格参考（5.6）。这是校内已完成交易的统计，不是估价，也不是成交保证。
 *
 * <p>口径：同一学校；单件商品（排除整套打包）；只统计 COMPLETED；只用下单时写入的成交价快照
 * （旧订单没有快照，不猜）；取消、过期、争议、进行中的订单都不计。维度只有白名单里的
 * 分类（必填）、成色、教材版本（仅教材书籍），客户端不能任意分组。
 *
 * <p>隐私：只返回聚合值；样本少于 {@value #MIN_SAMPLE} 条时连样本数都不给、也不给区间；
 * 金额按量级取整（百元以下到 1 元、千元以下到 5 元、以上到 10 元），时间只到月——
 * 不返回任何单笔价格、买卖双方、商品标题、成交日期或宿舍楼。
 *
 * <p>防差分：样本数只返回下界档位（8、10、15、20…，即不小于 10 时向下取到 5 的倍数），
 * 相邻两次查询之间多成交一笔，通常看不出样本数变化；维度固定为白名单，
 * 不能用任意组合把某一笔交易单独切出来。
 */
@Service
public class PriceGuidanceService {

    public static final int MIN_SAMPLE = 8;
    private static final Set<String> PARAMS = Set.of("category", "condition", "textbookEditionId");
    public static final String NOTE = "这是校内历史已完成交易的统计参考，不是平台估价或成交保证。";

    private final SupplyMapper supply;
    private final DemandMapper demands;
    private final RateLimitService rateLimit;

    public PriceGuidanceService(SupplyMapper supply, DemandMapper demands, RateLimitService rateLimit) {
        this.supply = supply;
        this.demands = demands;
        this.rateLimit = rateLimit;
    }

    public Map<String, Object> guidance(String uid, Map<String, String> query) {
        for (String key : query.keySet()) {
            if (!PARAMS.contains(key)) throw ApiException.badRequest("不支持的统计维度：" + key);
        }
        String category = query.get("category");
        if (category == null || !MarketService.CATEGORIES.contains(category)) throw ApiException.badRequest("请选择有效的分类");
        String condition = blankToNull(query.get("condition"));
        if (condition != null && !MarketService.CONDITIONS.contains(condition)) throw ApiException.badRequest("成色无效");
        String edition = blankToNull(query.get("textbookEditionId"));
        if (edition != null && !MarketService.TEXTBOOK_CATEGORY.equals(category)) {
            throw ApiException.badRequest("只有教材书籍可以按教材版本统计");
        }
        rateLimit.consume(RateLimitService.Scope.PRICE_GUIDANCE, uid);
        String school = demands.selectUserSchool(UUID.fromString(uid));
        if (school == null) throw ApiException.unauthorized("登录已失效，请重新登录");

        Map<String, Object> row = supply.selectPriceGuidance(school, category, condition, edition);
        long count = row == null ? 0 : ((Number) row.get("sample_count")).longValue();
        Map<String, Object> result = new LinkedHashMap<>();
        Map<String, Object> basis = new LinkedHashMap<>();
        basis.put("category", category);
        basis.put("condition", condition);
        basis.put("textbookEditionId", edition);
        result.put("basis", basis);
        result.put("minimumSample", MIN_SAMPLE);
        result.put("note", NOTE);
        if (count < MIN_SAMPLE) {
            result.put("sufficient", false);
            result.put("sampleCount", null);
            return result;
        }
        result.put("sufficient", true);
        result.put("sampleCount", sampleBucket(count));
        result.put("sampleCountIsLowerBound", true);
        result.put("median", yuan(row.get("median")));
        result.put("lowerQuartile", yuan(row.get("lower_quartile")));
        result.put("upperQuartile", yuan(row.get("upper_quartile")));
        result.put("periodStart", DomainMapper.text(row.get("period_start")));
        result.put("periodEnd", DomainMapper.text(row.get("period_end")));
        return result;
    }

    /** 样本数的下界档位：8、9 → 8；10 及以上向下取到 5 的倍数。 */
    static long sampleBucket(long count) {
        return count < 10 ? MIN_SAMPLE : count - count % 5;
    }

    /** 按量级取整：展示的是区间感，不是精确到分的某一笔成交。 */
    static long yuan(Object raw) {
        BigDecimal value = raw instanceof BigDecimal b ? b : new BigDecimal(String.valueOf(raw));
        long step = value.compareTo(BigDecimal.valueOf(100)) < 0 ? 1 : value.compareTo(BigDecimal.valueOf(1000)) < 0 ? 5 : 10;
        return value.divide(BigDecimal.valueOf(step), 0, RoundingMode.HALF_UP).longValue() * step;
    }

    private static String blankToNull(String raw) {
        return raw == null || raw.isBlank() ? null : raw.trim();
    }
}
