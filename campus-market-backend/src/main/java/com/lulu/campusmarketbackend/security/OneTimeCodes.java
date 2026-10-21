package com.lulu.campusmarketbackend.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;

/**
 * 由工作人员交给用户、需要人工抄写或转述的一次性码：重置码（阶段 3）与注册邀请码（V23）共用同一套规则。
 *
 * <ul>
 *   <li>字母表去掉了容易看错的 0 / O / 1 / I / L；12 位，显示为 {@code XXXX-XXXX-XXXX}；</li>
 *   <li>比对前规范化：转大写、去掉空格与连字符（用户抄写时常带空格、小写或漏掉连字符）；</li>
 *   <li>库里只存规范化之后的 SHA-256（小写十六进制），明文只在签发的那一次响应里出现。</li>
 * </ul>
 */
public final class OneTimeCodes {
    public static final String ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    public static final int LENGTH = 12;
    private static final char[] CHARS = ALPHABET.toCharArray();

    private OneTimeCodes() {}

    /** 新的一次性码，形如 {@code ABCD-EFGH-JKMN}。 */
    public static String generate(SecureRandom random) {
        StringBuilder sb = new StringBuilder(LENGTH + 2);
        for (int i = 0; i < LENGTH; i++) {
            if (i > 0 && i % 4 == 0) sb.append('-');
            sb.append(CHARS[random.nextInt(CHARS.length)]);
        }
        return sb.toString();
    }

    /** 转大写，去掉空白（含全角空格）与连字符（含全角连字符）。不校验内容，见 {@link #isWellFormed}。 */
    public static String normalize(String code) {
        StringBuilder sb = new StringBuilder(code.length());
        code.codePoints().forEach(cp -> {
            if (Character.isWhitespace(cp) || Character.isSpaceChar(cp) || cp == '-' || cp == '－') return;
            sb.appendCodePoint(cp);
        });
        return sb.toString().toUpperCase(Locale.ROOT);
    }

    /** 规范化之后是否恰好是 12 位字母表内的字符。 */
    public static boolean isWellFormed(String normalized) {
        if (normalized == null || normalized.length() != LENGTH) return false;
        for (int i = 0; i < normalized.length(); i++) if (ALPHABET.indexOf(normalized.charAt(i)) < 0) return false;
        return true;
    }

    /** 规范化后的 12 位码显示成 {@code XXXX-XXXX-XXXX}。 */
    public static String format(String normalized) {
        return normalized.substring(0, 4) + "-" + normalized.substring(4, 8) + "-" + normalized.substring(8, 12);
    }

    public static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
