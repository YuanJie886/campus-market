package com.lulu.campusmarketbackend.textbook;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** ISBN 规范化与校验（纯单元测试，不需要数据库）。前端 utils/isbn.ts 用同一组号码对照。 */
class IsbnTest {

    @Test
    @DisplayName("规范化：空格、半角 / 全角连字符、长破折号都被去掉；末位 x 转大写；ISBN-10 转为规范 ISBN-13")
    void normalizes() {
        assertThat(Isbn.parse("978-0-306-40615-7").isbn13()).isEqualTo("9780306406157");
        assertThat(Isbn.parse(" 978 0306 40615 7 ").isbn13()).isEqualTo("9780306406157");
        assertThat(Isbn.parse("978－0－306－40615－7").isbn13()).isEqualTo("9780306406157");
        Isbn.Parsed ten = Isbn.parse("0-8044-2957-x");
        assertThat(ten.isbn10()).isEqualTo("080442957X");
        assertThat(ten.isbn13()).isEqualTo("9780804429573");
        assertThat(Isbn.parse("0306406152").isbn13()).isEqualTo("9780306406157");
        assertThat(Isbn.parse("979-10-90636-07-1").isbn13()).as("979-1 是图书号段").isEqualTo("9791090636071");
        assertThat(Isbn.parse("979-8-6500-0001-3").isbn13()).as("979-8 是图书号段").isEqualTo("9798650000013");
    }

    @Test
    @DisplayName("4.8：979-0 是乐谱号（ISMN）号段——即使校验位合法也不是图书 ISBN，拒绝并说明原因")
    void rejectsIsmn() {
        for (String ismn : new String[]{"9790000001022", "979-0-000001-01-5", "979 0 000001 03 9"}) {
            assertThatThrownBy(() -> Isbn.parse(ismn)).as(ismn)
                    .isInstanceOf(Isbn.InvalidIsbnException.class).hasMessageContaining("乐谱号");
        }
    }

    @Test
    @DisplayName("校验位错误、长度错误、前缀错误、X 位置错误一律拒绝")
    void rejectsInvalid() {
        for (String bad : new String[]{"9780306406158", "0306406153", "978030640615", "1234567890123", "08044X2957", "abc", ""}) {
            assertThatThrownBy(() -> Isbn.parse(bad)).as(bad).isInstanceOf(Isbn.InvalidIsbnException.class);
        }
    }
}
