package com.lulu.campusmarketbackend.api;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * JSON 请求体的正向字段白名单。
 *
 * <p>每个写接口只枚举它<b>真实读取</b>的字段，其余一律 400。这样身份与状态字段
 * （userId / buyerId / sellerId / senderId / status / createdAt / codeAttempts …）
 * 不需要逐个拉黑名单，天然就进不来——R-01 的 {@code __buyerId} 越权正是缺这层导致的。
 *
 * <p>校验必须在任何数据库写入之前调用，保证被拒请求零副作用。
 * 本工具只负责「未知字段」，不替代各字段自身的类型与格式校验。
 */
public final class JsonFieldPolicy {

    private JsonFieldPolicy() {}

    /**
     * 拒绝 body 中任何不在 allowed 内的字段。
     *
     * <p>字段名先排序再拼接，保证同一组非法字段每次产生一致的错误信息（便于稳定断言）；
     * 只回显字段<b>名</b>，绝不回显字段值——值可能是口令、令牌或确认码。
     *
     * @param body    请求体；null 视为空 map，交由各接口的必填校验处理
     * @param allowed 该接口允许出现的字段名
     */
    public static void rejectUnknown(Map<String, Object> body, Set<String> allowed) {
        if (body == null || body.isEmpty()) return;
        List<String> unknown = body.keySet().stream().filter(key -> !allowed.contains(key)).sorted().toList();
        if (!unknown.isEmpty()) {
            throw ApiException.badRequest("请求包含不支持的字段：" + String.join("、", unknown));
        }
    }
}
