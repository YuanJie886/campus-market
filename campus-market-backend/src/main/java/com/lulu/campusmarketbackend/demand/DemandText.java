package com.lulu.campusmarketbackend.demand;

import java.util.Locale;

/**
 * 需求雷达的文本规范化——订阅关键词与商品标题/描述<b>共用这一份</b>规则。
 *
 * <p>匹配的本质是「规范化后的商品文本是否包含规范化后的关键词」。两边只要有一处
 * 规范化方式不同（一边折叠了全角空格、另一边没有），就会出现用户明明看到标题里有
 * 这个词、却收不到通知的情况。因此规范化只在 Java 里做一次，SQL 只比较结果，
 * 不在数据库里再写一遍 lower()/regexp_replace()。
 *
 * <p>规则：Unicode 空白（含全角空格 U+3000、不间断空格）折叠为单个 ASCII 空格，
 * 去掉首尾空白，按 {@link Locale#ROOT} 转小写。前端 Mock 的 normalizeDemandText
 * 与此逐条一致。
 */
public final class DemandText {

    /** 规范化后的关键词最大长度，与 V4 的 CHECK 一致。 */
    public static final int MAX_KEYWORD_LENGTH = 40;

    private DemandText() {}

    public static String normalize(String raw) {
        if (raw == null) return "";
        // (?U) 让 \s 匹配全部 Unicode 空白，而不只是 ASCII 的空格与制表符
        return raw.replaceAll("(?U)\\s+", " ").strip().toLowerCase(Locale.ROOT);
    }

    /**
     * 规范化文本是否包含规范化关键词。
     *
     * <p>用普通子串包含，不用 LIKE：关键词里的 {@code %}、{@code _} 就是字面字符，
     * 不会被当作通配符——用户搜「100%纯棉」不应该匹配到「100 件纯棉」。
     */
    public static boolean contains(String normalizedText, String normalizedKeyword) {
        return normalizedKeyword != null && !normalizedKeyword.isEmpty()
                && normalizedText != null && normalizedText.contains(normalizedKeyword);
    }
}
