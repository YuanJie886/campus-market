package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.BundleMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 整套打包商品（5.1C / 5.4）：一个商品主体 + 2～30 条明细。
 *
 * <p>明细不是商品：没有自己的 id、价格或状态，不能被单独下单；打包总价属于主体商品，
 * 预约、锁定、完成、下架都走原有的单商品状态机，仍然只生成一个订单。
 * 需求雷达按主体商品（标题、描述、主分类）匹配，<b>不</b>把明细当作独立商品匹配。
 */
@Service
public class BundleService {

    public static final int MIN_ITEMS = 2;
    public static final int MAX_ITEMS = 30;
    private static final Set<String> ITEM_FIELDS = Set.of("itemCode", "name", "category", "condition", "quantity", "note");
    private static final List<String> CONDITIONS = List.of("全新", "几乎全新", "轻微使用痕迹", "明显使用痕迹");

    private final BundleMapper bundles;

    public BundleService(BundleMapper bundles) {
        this.bundles = bundles;
    }

    /** 校验并规范化明细。没有提供 itemCode 的条目按顺序分配 I01、I02…… */
    public List<BundleMapper.ItemRow> parse(Object raw) {
        if (!(raw instanceof List<?> list)) throw ApiException.badRequest("整套打包需要提供明细列表");
        if (list.size() < MIN_ITEMS || list.size() > MAX_ITEMS) {
            throw ApiException.badRequest("整套打包需要 " + MIN_ITEMS + "～" + MAX_ITEMS + " 条明细");
        }
        List<BundleMapper.ItemRow> result = new ArrayList<>();
        Set<String> codes = new HashSet<>();
        for (int i = 0; i < list.size(); i++) {
            if (!(list.get(i) instanceof Map<?, ?> item)) throw ApiException.badRequest("第 " + (i + 1) + " 条明细格式无效");
            for (Object key : item.keySet()) {
                if (!ITEM_FIELDS.contains(String.valueOf(key))) throw ApiException.badRequest("明细包含不支持的字段：" + key);
            }
            String code = item.get("itemCode") == null ? String.format("I%02d", i + 1) : String.valueOf(item.get("itemCode"));
            if (!code.matches("[A-Z0-9][A-Z0-9_-]{0,31}")) throw ApiException.badRequest("第 " + (i + 1) + " 条明细的编号无效");
            if (!codes.add(code)) throw ApiException.badRequest("明细编号重复：" + code);
            String name = text(item.get("name"), 60, "第 " + (i + 1) + " 条明细的名称");
            if (name.isEmpty()) throw ApiException.badRequest("第 " + (i + 1) + " 条明细缺少名称");
            String category = String.valueOf(item.get("category"));
            if (!MarketService.CATEGORIES.contains(category)) throw ApiException.badRequest("第 " + (i + 1) + " 条明细的分类无效");
            String condition = String.valueOf(item.get("condition"));
            if (!CONDITIONS.contains(condition)) throw ApiException.badRequest("第 " + (i + 1) + " 条明细的成色无效");
            int quantity;
            if (!(item.get("quantity") instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())
                    || n.intValue() < 1 || n.intValue() > 99) {
                throw ApiException.badRequest("第 " + (i + 1) + " 条明细的数量应为 1～99 的整数");
            }
            quantity = n.intValue();
            String note = item.get("note") == null ? "" : text(item.get("note"), 200, "第 " + (i + 1) + " 条明细的备注");
            result.add(new BundleMapper.ItemRow(code, name, category, condition, quantity, note, i));
        }
        return result;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void replace(UUID productId, List<BundleMapper.ItemRow> items) {
        bundles.deleteItems(productId);
        bundles.insertItems(productId, items);
    }

    /** 商品详情里的明细（一条 SQL，与明细数量无关）。 */
    public List<Map<String, Object>> items(UUID productId) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : bundles.selectItems(productId)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("itemCode", DomainMapper.text(row.get("item_code")));
            item.put("name", DomainMapper.text(row.get("name")));
            item.put("category", DomainMapper.text(row.get("category")));
            item.put("condition", DomainMapper.text(row.get("condition")));
            item.put("quantity", ((Number) row.get("quantity")).intValue());
            item.put("note", DomainMapper.text(row.get("note")));
            item.put("sortOrder", ((Number) row.get("sort_order")).intValue());
            result.add(item);
        }
        return result;
    }

    private static String text(Object raw, int max, String label) {
        if (!(raw instanceof String s)) throw ApiException.badRequest(label + "格式无效");
        String value = s.strip().replaceAll("(?U)\\s+", " ");
        if (value.length() > max) throw ApiException.badRequest(label + "最多 " + max + " 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest(label + "不能包含尖括号");
        return value;
    }
}
