package com.lulu.campusmarketbackend.textbook;

/**
 * ISBN 规范化与校验——后端唯一实现，与 V6 的 SQL 函数、前端 utils/isbn.ts 逐条一致。
 *
 * <ul>
 *   <li>去掉所有空白与连字符（含全角连字符「－」与长破折号），末位小写 x 转大写；</li>
 *   <li>10 位：前 9 位数字 + 末位数字或 X，按权重 10..1 求和能被 11 整除；</li>
 *   <li>13 位：以 978 / 979 开头，按 1、3 交替权重求和能被 10 整除；</li>
 *   <li>979-0 开头的是乐谱号（ISMN），不是图书 ISBN，一律拒绝（4.8）。V6 的 SQL 函数只校验格式，
 *       这条规则由应用层（本类与前端 utils/isbn.ts）保证；V6 已冻结，不改写它的函数定义。</li>
 *   <li>规范形式一律是 ISBN-13：ISBN-10 转换为 978 前缀并重算校验位。</li>
 * </ul>
 *
 * <p>只做格式与校验位判断，<b>不</b>根据书名、出版社猜测号码，也不做任何联网查询。
 */
public final class Isbn {

    private Isbn() {}

    /** 979-0 是国际标准乐谱号（ISMN）的号段，不分配给图书。 */
    public static final String ISMN_PREFIX = "9790";
    public static final String ISMN_MESSAGE = "979-0 开头的是乐谱号（ISMN），不是图书 ISBN，请核对号码";

    /** 解析结果：isbn10 仅当输入就是 10 位时存在；isbn13 永远是规范形式。 */
    public record Parsed(String isbn10, String isbn13) {}

    /** 输入无法成为合法 ISBN 时的原因，供错误提示使用。 */
    public static final class InvalidIsbnException extends IllegalArgumentException {
        public InvalidIsbnException(String message) { super(message); }
    }

    /** 去掉空白与各种连字符，末位 x 转大写。不做任何校验。 */
    public static String strip(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[\\s\\-‐-―−－]", "").toUpperCase(java.util.Locale.ROOT);
    }

    public static Parsed parse(String raw) {
        String v = strip(raw);
        if (v.length() == 10) {
            if (!v.matches("[0-9]{9}[0-9X]")) throw new InvalidIsbnException("ISBN-10 只能包含数字，末位可以是 X");
            if (!valid10(v)) throw new InvalidIsbnException("ISBN-10 校验位不正确，请核对号码");
            return new Parsed(v, to13(v));
        }
        if (v.length() == 13) {
            if (!v.matches("[0-9]{13}")) throw new InvalidIsbnException("ISBN-13 只能包含数字");
            if (!v.startsWith("978") && !v.startsWith("979")) throw new InvalidIsbnException("ISBN-13 应以 978 或 979 开头");
            if (v.startsWith(ISMN_PREFIX)) throw new InvalidIsbnException(ISMN_MESSAGE);
            if (!valid13(v)) throw new InvalidIsbnException("ISBN-13 校验位不正确，请核对号码");
            return new Parsed(null, v);
        }
        throw new InvalidIsbnException("ISBN 应为 10 位或 13 位（可以包含空格或连字符）");
    }

    static boolean valid10(String v) {
        int sum = 0;
        for (int i = 0; i < 10; i++) {
            char c = v.charAt(i);
            int digit = c == 'X' ? 10 : c - '0';
            if (c == 'X' && i != 9) return false;
            sum += digit * (10 - i);
        }
        return sum % 11 == 0;
    }

    static boolean valid13(String v) {
        int sum = 0;
        for (int i = 0; i < 13; i++) sum += (v.charAt(i) - '0') * (i % 2 == 0 ? 1 : 3);
        return sum % 10 == 0;
    }

    static String to13(String isbn10) {
        String body = "978" + isbn10.substring(0, 9);
        int sum = 0;
        for (int i = 0; i < 12; i++) sum += (body.charAt(i) - '0') * (i % 2 == 0 ? 1 : 3);
        return body + ((10 - sum % 10) % 10);
    }
}
