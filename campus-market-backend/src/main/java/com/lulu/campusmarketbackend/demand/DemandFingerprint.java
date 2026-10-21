package com.lulu.campusmarketbackend.demand;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 订阅条件指纹：对<b>规范化后</b>的条件求 SHA-256。
 *
 * <p>用途只有一个——幂等：同一用户用同样的条件重复订阅，得到的是原来那一条。
 * 因此只包含「条件」本身，不包含用户 id、学校或任何秘密；用户维度由唯一索引
 * {@code (user_id, fingerprint) WHERE active} 负责。指纹只由服务端计算，
 * 客户端传入的 fingerprint 字段会被白名单直接拒绝。
 *
 * <p>ZONE 以「校区/园区」作为锚点，而不是具体楼栋：同一园区里挑哪栋楼当锚点，
 * 表达的是同一个需求，不应产生两条订阅。
 */
public final class DemandFingerprint {

    private DemandFingerprint() {}

    public static String of(String normalizedKeyword, String category, BigDecimal min, BigDecimal max,
                            String geoScope, String campusId, String buildingId, String zone) {
        return of(normalizedKeyword, category, min, max, geoScope, campusId, buildingId, zone, null);
    }

    /**
     * 模块 4：精确教材版本订阅把版本 id 纳入指纹。
     *
     * <p>兼容性：没有教材版本时<b>一个字节都不变</b>——规范串与 V4 时代完全相同，
     * 既有订阅的指纹与幂等行为保持有效；只有带教材版本的订阅才多出一行 {@code tb=}。
     */
    public static String of(String normalizedKeyword, String category, BigDecimal min, BigDecimal max,
                            String geoScope, String campusId, String buildingId, String zone,
                            String textbookEditionId) {
        return of(normalizedKeyword, category, min, max, geoScope, campusId, buildingId, zone, textbookEditionId, null);
    }

    /**
     * 模块 6：圈子范围订阅把圈子 id 纳入指纹。没有圈子时同样一个字节都不变。
     */
    public static String of(String normalizedKeyword, String category, BigDecimal min, BigDecimal max,
                            String geoScope, String campusId, String buildingId, String zone,
                            String textbookEditionId, String circleId) {
        String anchor = switch (geoScope) {
            case "BUILDING" -> buildingId;
            case "ZONE" -> campusId + "/" + zone;
            case "CAMPUS" -> campusId;
            default -> "";
        };
        String canonical = String.join("\n",
                "v1",
                "kw=" + nullToEmpty(normalizedKeyword),
                "cat=" + nullToEmpty(category),
                "min=" + plain(min),
                "max=" + plain(max),
                "geo=" + geoScope,
                "anchor=" + nullToEmpty(anchor))
                + (textbookEditionId == null ? "" : "\ntb=" + textbookEditionId)
                + (circleId == null ? "" : "\ncircle=" + circleId);
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    /** 10、10.0、10.00 视为同一价格。 */
    private static String plain(BigDecimal value) {
        return value == null ? "" : value.stripTrailingZeros().toPlainString();
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
