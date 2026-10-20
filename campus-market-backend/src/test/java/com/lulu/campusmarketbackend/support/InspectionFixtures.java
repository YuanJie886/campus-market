package com.lulu.campusmarketbackend.support;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 测试用的完整验货声明。
 *
 * <p>模块 3 起，受支持分类的新商品必须逐项表态。与验货无关的既有集成测试
 * 通过这里补上一份完整、合法的声明，<b>不改动它们原有的任何断言</b>。
 * 条目机器码与 V5 迁移中的模板种子逐条一致；一旦种子变动，这里会让测试立刻失败。
 */
public final class InspectionFixtures {

    private InspectionFixtures() {}

    private static final Map<String, List<String>> CODES = Map.of(
            "数码电子", List.of("POWER_ON", "SCREEN", "BATTERY", "PORTS_BUTTONS", "CAMERA_AUDIO",
                    "ACCOUNT_UNBOUND", "ACCESSORIES", "APPEARANCE"),
            "教材书籍", List.of("EDITION", "PAGES_COMPLETE", "NOTES", "COVER", "WATER_DAMAGE"),
            "生活用品", List.of("FUNCTION", "APPEARANCE", "CLEAN", "PARTS_COMPLETE", "ELECTRICAL"),
            "服饰鞋包", List.of("SIZE", "STAINS", "DAMAGE", "MATERIAL", "WEAR"),
            "运动户外", List.of("STRUCTURE", "FUNCTION", "WEAR", "PARTS_COMPLETE", "SAFETY"));

    /** 该分类的全部条目机器码；不支持的分类返回空列表。 */
    public static List<String> codes(String category) {
        return CODES.getOrDefault(category, List.of());
    }

    /** 每一项都声明为 NORMAL 的完整清单；不支持的分类返回 null（不提交清单）。 */
    public static List<Map<String, Object>> fullDisclosure(String category) {
        if (!CODES.containsKey(category)) return null;
        return disclosure(category, "NORMAL");
    }

    /** 每一项都声明为指定状态的完整清单。 */
    public static List<Map<String, Object>> disclosure(String category, String condition) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (String code : codes(category)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("itemCode", code);
            item.put("condition", condition);
            items.add(item);
        }
        return items;
    }
}
