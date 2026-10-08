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

    /**
     * 以买家身份把订单验货清单逐项标为 MATCH 并最终提交。
     *
     * <p>模块 3 起，有结构化声明的订单必须先验货，买家才能确认。与验货无关的既有订单测试
     * 在「买家确认」之前调用它，走的是真实接口，而不是绕开闸门。
     * 条目直接取自订单自己的快照，与商品分类无关；没有清单（NOT_PROVIDED）时什么也不做。
     */
    public static void submitAllMatch(org.springframework.test.web.servlet.MockMvc mockMvc,
                                      com.fasterxml.jackson.databind.ObjectMapper json,
                                      String buyerToken, String orderId) throws Exception {
        String flow = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/v1/orders/" + orderId + "/flow").header("Authorization", "Bearer " + buyerToken))
                .andReturn().getResponse().getContentAsString();
        com.fasterxml.jackson.databind.JsonNode inspection = json.readTree(flow).path("data").path("inspection");
        if (!"PENDING".equals(inspection.path("status").asText())) return;
        List<Map<String, Object>> items = new ArrayList<>();
        for (com.fasterxml.jackson.databind.JsonNode item : inspection.path("items")) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("itemCode", item.path("code").asText());
            row.put("result", "MATCH");
            items.add(row);
        }
        int status = mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/v1/orders/" + orderId + "/inspection/submit")
                        .header("Authorization", "Bearer " + buyerToken)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("items", items))))
                .andReturn().getResponse().getStatus();
        if (status != 200) throw new AssertionError("验货提交失败：HTTP " + status);
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
