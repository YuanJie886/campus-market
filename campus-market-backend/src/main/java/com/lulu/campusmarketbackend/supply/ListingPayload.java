package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 草稿内容的服务端字段白名单（5.1A）。
 *
 * <p>草稿允许不完整，所以这里只做「形状与长度」检查，不做正式商品校验（那在进入 READY
 * 与发布时由 {@link ListingValidator} 与商品发布本身完成）。sellerId、ownerId、schoolId、status、
 * createdAt 等服务端字段不在白名单里，出现即 400；即使存为 JSONB，也只有这些键能落库。
 */
public final class ListingPayload {

    public static final Set<String> FIELDS = Set.of(
            "title", "description", "price", "originalPrice", "category", "condition", "campus",
            "images", "contact", "buildingId", "inspection", "textbookEditionId", "bundleItems",
            // 模块 6：可见范围。不在协助人可整理的字段里——协助人不能替所有者选择圈子
            "visibility", "circleIds");
    /** 协助人不能写的字段：联系方式只属于所有者本人 */
    public static final Set<String> OWNER_ONLY_FIELDS = Set.of("contact");
    /** 协助人可以整理的字段（5.5）：标题、描述、分类、价格建议、打包明细、取货楼栋建议。其余字段只能原样保留 */
    public static final Set<String> ASSISTANT_FIELDS = Set.of("title", "description", "category", "price", "bundleItems", "buildingId");
    private static final Set<String> INSPECTION_KEYS = Set.of("itemCode", "condition", "note");
    private static final Set<String> BUNDLE_KEYS = Set.of("itemCode", "name", "category", "condition", "quantity", "note");

    private ListingPayload() {}

    public static Map<String, Object> sanitize(Object raw, boolean assistant) {
        if (raw == null) return new LinkedHashMap<>();
        if (!(raw instanceof Map<?, ?> map)) throw ApiException.badRequest("草稿内容格式无效");
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (!FIELDS.contains(key)) throw ApiException.badRequest("草稿包含不支持的字段：" + key);
            if (assistant && OWNER_ONLY_FIELDS.contains(key)) throw ApiException.forbidden("协助人不能填写联系方式");
            Object value = entry.getValue();
            if (value == null) { result.put(key, null); continue; }
            switch (key) {
                case "title" -> result.put(key, string(value, 100, "标题"));
                case "description" -> result.put(key, string(value, 4000, "描述"));
                case "contact" -> result.put(key, string(value, 100, "联系方式"));
                case "category", "condition", "campus" -> result.put(key, string(value, 20, key));
                case "buildingId", "textbookEditionId" -> result.put(key, string(value, 64, key));
                case "visibility" -> result.put(key, string(value, 20, key));
                case "circleIds" -> result.put(key, list(value, 6, "圈子", v -> string(v, 64, "圈子 id")));
                case "price", "originalPrice" -> {
                    if (!(value instanceof Number) && !(value instanceof String s && s.length() <= 20)) {
                        throw ApiException.badRequest(key + " 格式无效");
                    }
                    result.put(key, value);
                }
                case "images" -> result.put(key, list(value, 9, "图片", v -> string(v, 2048, "图片地址")));
                case "inspection" -> result.put(key, list(value, 40, "验货清单", v -> object(v, INSPECTION_KEYS, "验货条目")));
                case "bundleItems" -> result.put(key, list(value, BundleService.MAX_ITEMS + 1, "打包明细", v -> object(v, BUNDLE_KEYS, "打包明细")));
                default -> throw ApiException.badRequest("草稿包含不支持的字段：" + key);
            }
        }
        return result;
    }

    private static String string(Object value, int max, String label) {
        if (!(value instanceof String s)) throw ApiException.badRequest(label + " 格式无效");
        if (s.length() > max) throw ApiException.badRequest(label + " 最多 " + max + " 个字");
        return s;
    }

    private static List<Object> list(Object value, int max, String label, java.util.function.Function<Object, Object> each) {
        if (!(value instanceof List<?> items)) throw ApiException.badRequest(label + " 格式无效");
        if (items.size() > max) throw ApiException.badRequest(label + " 最多 " + max + " 项");
        return items.stream().map(each).toList();
    }

    private static Map<String, Object> object(Object value, Set<String> keys, String label) {
        if (!(value instanceof Map<?, ?> map)) throw ApiException.badRequest(label + " 格式无效");
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : map.entrySet()) {
            String key = String.valueOf(e.getKey());
            if (!keys.contains(key)) throw ApiException.badRequest(label + "包含不支持的字段：" + key);
            Object v = e.getValue();
            if (v != null && !(v instanceof String || v instanceof Number) || v instanceof String s && s.length() > 200) {
                throw ApiException.badRequest(label + "的「" + key + "」格式无效");
            }
            result.put(key, v);
        }
        return result;
    }
}
