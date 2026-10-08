package com.lulu.campusmarketbackend.textbook;

import com.lulu.campusmarketbackend.demand.DemandText;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * 没有 ISBN 的教材（讲义、校内自编教材）的元数据指纹。
 *
 * <p>只用于<b>防止明显重复</b>：同一学校目录里，书名、作者、出版方、版次、年份规范化后完全相同，
 * 视为同一本。版次不同就是不同的指纹——不同版次永不合并。这不是「相似书名匹配」：
 * 任何一个字段不同都得到不同的指纹，也从不据此把商品自动关联到某个版本。
 */
public final class TextbookFingerprint {

    private TextbookFingerprint() {}

    public static String of(String title, List<String> authors, String publisher, String editionLabel, Integer year) {
        String canonical = String.join("\n",
                "tb-v1",
                "title=" + DemandText.normalize(title),
                "authors=" + DemandText.normalize(String.join("、", authors)),
                "publisher=" + DemandText.normalize(publisher),
                "edition=" + DemandText.normalize(editionLabel),
                "year=" + (year == null ? "" : year.toString()));
        return sha256(canonical);
    }

    static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
