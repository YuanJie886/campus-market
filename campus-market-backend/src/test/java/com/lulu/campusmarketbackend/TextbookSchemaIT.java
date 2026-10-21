package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.textbook.TextbookFingerprint;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V6 课程教材图谱的数据库层约束（4.1）。全部绕过服务层直接写 SQL：
 * 即使将来有写错的接口或手工修数据，也造不出跨学校关系、非法 ISBN、重复版本或伪造的公开建议。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@ActiveProfiles("test")
class TextbookSchemaIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_textbook_schema")
            .withUsername("campus_ts").withPassword("campus_ts_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "textbook-schema-it-secret-0123456789ab");
    }

    @Autowired private JdbcTemplate jdbc;
    private UUID user;

    @BeforeEach
    void setUp() {
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,?,?)",
                user, "ts" + user, "x", "schema", "东校区");
        jdbc.update("INSERT INTO schools(id,name) VALUES ('other-school','另一所学校') ON CONFLICT DO NOTHING");
        jdbc.update("INSERT INTO campuses(id,school_id,name) VALUES ('他校区','other-school','他校区') ON CONFLICT DO NOTHING");
    }

    /** 随机但校验位合法的 ISBN-13：各用例共享同一个库，避免彼此撞号。 */
    private static String randomIsbn() {
        String body = "978" + String.format("%09d", java.util.concurrent.ThreadLocalRandom.current().nextInt(1_000_000_000));
        int sum = 0;
        for (int i = 0; i < 12; i++) sum += (body.charAt(i) - '0') * (i % 2 == 0 ? 1 : 3);
        return body + ((10 - sum % 10) % 10);
    }

    private static Object[] randomIsbnPair() {
        String isbn = randomIsbn();
        return new Object[]{isbn, isbn};
    }

    private static String id(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private String course(String school) {
        String id = id("c");
        jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name) VALUES (?,?,?,?)", id, school, "课 " + id, "课 " + id);
        return id;
    }

    private String offering(String course, String school) {
        String id = id("o");
        jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES (?,?,?,'2026-2027','AUTUMN')",
                id, course, school);
        return id;
    }

    private String edition(String school, String isbn13) {
        String id = id("e");
        jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label) "
                + "VALUES (?,?,?,?,'书',ARRAY['作者'],'出版社','第 1 版')", id, school, isbn13, isbn13);
        return id;
    }

    private UUID product(String category, String campus) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus) "
                + "VALUES (?,?,'t','d',10,?,'全新',?)", id, user, category, campus);
        return id;
    }

    private void link(UUID product, String school, String edition) {
        jdbc.update("INSERT INTO product_textbook_details(product_id,school_id,textbook_edition_id,isbn_snapshot,"
                + "title_snapshot,edition_snapshot,publisher_snapshot) VALUES (?,?,?,NULL,'书','第 1 版','出版社')",
                product, school, edition);
    }

    @Test
    @DisplayName("1. ISBN 校验位在数据库里真实验证：ISBN-13 / ISBN-10 错一位都被拒；ISBN-10 必须与规范 ISBN-13 一致")
    void isbnChecksumsAreEnforced() {
        assertThat(jdbc.queryForObject("SELECT isbn13_is_valid('9780306406157')", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT isbn13_is_valid('9780306406158')", Boolean.class)).isFalse();
        assertThat(jdbc.queryForObject("SELECT isbn10_is_valid('080442957X')", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("SELECT isbn10_is_valid('0804429579')", Boolean.class)).isFalse();
        assertThat(jdbc.queryForObject("SELECT isbn10_to_isbn13('0306406152')", String.class)).isEqualTo("9780306406157");

        assertThatThrownBy(() -> edition("pilot", "9780306406158")).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn10,normalized_isbn,title,authors,publisher,edition_label) "
                + "VALUES ('bad-isbn10','pilot','0306406152','9780306406158','书',ARRAY['a'],'p','v')"))
                .as("ISBN-10 与规范号不一致").isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn10,normalized_isbn,title,authors,publisher,edition_label) "
                + "VALUES ('ok-isbn10','pilot','0306406152','9780306406157','书',ARRAY['a'],'p','v')");
    }

    @Test
    @DisplayName("2. 同一学校同一 ISBN 只能有一个版本；另一所学校可以有自己的目录行；ISBN 与无 ISBN 指纹恰好二选一")
    void isbnUniquePerSchoolAndFingerprintRules() {
        String isbn = randomIsbn();
        edition("pilot", isbn);
        assertThatThrownBy(() -> edition("pilot", isbn)).isInstanceOf(DataIntegrityViolationException.class);
        edition("other-school", isbn);

        String fp = "b".repeat(64);
        jdbc.update("INSERT INTO textbook_editions(id,school_id,title,authors,publisher,edition_label,no_isbn_fingerprint) "
                + "VALUES ('notes-1','pilot','讲义',ARRAY['a'],'p','2026 版',?)", fp);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_editions(id,school_id,title,authors,publisher,edition_label,no_isbn_fingerprint) "
                + "VALUES ('notes-2','pilot','讲义',ARRAY['a'],'p','2026 版',?)", fp)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_editions(id,school_id,title,authors,publisher,edition_label) "
                + "VALUES ('neither','pilot','讲义',ARRAY['a'],'p','v')")).as("既无 ISBN 又无指纹").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label,no_isbn_fingerprint) "
                + "VALUES ('both','pilot',?,?,'书',ARRAY['a'],'p','v',?)", isbn, isbn, "c".repeat(64)))
                .as("ISBN 与指纹同时存在").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_editions(id,school_id,isbn13,normalized_isbn,title,authors,publisher,edition_label,cover_url) "
                + "VALUES ('js-cover','pilot',?,?,'书',ARRAY['a'],'p','v','javascript:alert(1)')", (Object[]) randomIsbnPair()))
                .as("封面只允许 https").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("3. 课程：同校规范化名称唯一；学期只能是 canonical 值；开课校区必须属于课程学校；开课防重复")
    void courseAndOfferingConstraints() {
        String c = course("pilot");
        String name = jdbc.queryForObject("SELECT normalized_name FROM courses WHERE id=?", String.class, c);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name) VALUES ('dup-course','pilot','x',?)", name))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO courses(id,school_id,name,normalized_name) VALUES ('upper-course','pilot','X','Calculus')"))
                .as("规范化名称必须小写").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('bad-term',?,'pilot','2026-2027','FALL')", c))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('bad-year',?,'pilot','2026-2028','AUTUMN')", c))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term,campus_id) VALUES ('x-campus',?,'pilot','2026-2027','AUTUMN','他校区')", c))
                .as("开课校区属于另一所学校").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term) VALUES ('x-school',?,'other-school','2026-2027','AUTUMN')", c))
                .as("开课与课程学校不一致").isInstanceOf(DataIntegrityViolationException.class);
        jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term,instructor_name) VALUES ('o-1',?,'pilot','2026-2027','AUTUMN','演示教师')", c);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term,instructor_name) VALUES ('o-2',?,'pilot','2026-2027','AUTUMN','演示教师')", c))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_offerings(id,course_id,school_id,academic_year,term,instructor_name) VALUES ('o-3',?,'pilot','2026-2027','SPRING','teacher@x.com')", c))
                .as("教师标签不能夹带联系方式").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("4. 课程—教材关系：跨学校失败；同一开课与版本唯一；状态与用途只能是 canonical 值")
    void courseTextbookConstraints() {
        String o = offering(course("pilot"), "pilot");
        String e = edition("pilot", randomIsbn());
        String foreign = edition("other-school", randomIsbn());
        jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) VALUES (?,?,'pilot','REQUIRED','VERIFIED')", o, e);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) VALUES (?,?,'pilot','REFERENCE','PENDING')", o, e))
                .as("重复关系").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) VALUES (?,?,'pilot','REQUIRED','VERIFIED')", o, foreign))
                .as("教材属于另一所学校").isInstanceOf(DataIntegrityViolationException.class);
        String e2 = edition("pilot", randomIsbn());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) VALUES (?,?,'pilot','MUST','VERIFIED')", o, e2))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO course_textbooks(course_offering_id,textbook_edition_id,school_id,usage_type,verification_status) VALUES (?,?,'pilot','REQUIRED','AUTO_APPROVED')", o, e2))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("5. 商品关联：只允许教材书籍分类；学校必须一致；已关联商品不能改成其他分类；版本不变时快照不可改写")
    void productTextbookGuards() {
        String e = edition("pilot", randomIsbn());
        UUID digital = product("数码电子", "东校区");
        assertThatThrownBy(() -> link(digital, "pilot", e)).isInstanceOf(DataIntegrityViolationException.class);

        UUID book = product("教材书籍", "东校区");
        String foreign = edition("other-school", randomIsbn());
        assertThatThrownBy(() -> link(book, "other-school", foreign)).as("商品在试点学校，教材在另一所学校")
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> link(book, "pilot", foreign)).as("school_id 与版本学校不一致（复合外键）")
                .isInstanceOf(DataIntegrityViolationException.class);

        link(book, "pilot", e);
        assertThatThrownBy(() -> link(book, "pilot", e)).as("一个商品至多一个版本").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET category='数码电子' WHERE id=?", book))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE products SET campus='他校区' WHERE id=?", book))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE product_textbook_details SET title_snapshot='改过的书名' WHERE product_id=?", book))
                .isInstanceOf(DataIntegrityViolationException.class);
        // 解除关联后才可以改分类
        jdbc.update("DELETE FROM product_textbook_details WHERE product_id=?", book);
        jdbc.update("UPDATE products SET category='数码电子' WHERE id=?", book);
    }

    @Test
    @DisplayName("6. 建议：状态只有 PENDING / WITHDRAWN（没有 VERIFIED）；同人同建议待审核中唯一；跨学校开课失败")
    void suggestionConstraints() {
        String o = offering(course("pilot"), "pilot");
        String fp = "d".repeat(64);
        jdbc.update("INSERT INTO textbook_suggestions(id,submitter_id,school_id,course_offering_id,isbn13,usage_type,fingerprint) "
                + "VALUES (?,?,'pilot',?,'9780000000019','REQUIRED',?)", UUID.randomUUID(), user, o, fp);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_suggestions(id,submitter_id,school_id,course_offering_id,isbn13,usage_type,fingerprint) "
                + "VALUES (?,?,'pilot',?,'9780000000019','REQUIRED',?)", UUID.randomUUID(), user, o, fp)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_suggestions(id,submitter_id,school_id,course_offering_id,isbn13,usage_type,fingerprint,status) "
                + "VALUES (?,?,'pilot',?,'9780000000019','REQUIRED',?,'VERIFIED')", UUID.randomUUID(), user, o, "e".repeat(64)))
                .as("建议不能被写成 VERIFIED").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_suggestions(id,submitter_id,school_id,course_offering_id,isbn13,usage_type,fingerprint) "
                + "VALUES (?,?,'other-school',?,'9780000000019','REQUIRED',?)", UUID.randomUUID(), user, o, "f".repeat(64)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO textbook_suggestions(id,submitter_id,school_id,course_offering_id,isbn13,usage_type,fingerprint) "
                + "VALUES (?,?,'pilot',?,'9780000000018','REQUIRED',?)", UUID.randomUUID(), user, o, "9".repeat(64)))
                .as("建议里的 ISBN 同样校验").isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("7. 教材订阅：版本必须同校；形状（分类=教材书籍、无关键词）；同人同版本只能一条启用订阅；新理由码约束生效")
    void demandTextbookConstraints() {
        String e = edition("pilot", randomIsbn());
        String foreign = edition("other-school", randomIsbn());
        String sql = "INSERT INTO demand_subscriptions(id,user_id,school_id,category,keyword,normalized_keyword,geo_scope,fingerprint,textbook_edition_id) "
                + "VALUES (?,?,?,?,?,?,'SCHOOL',?,?)";
        jdbc.update(sql, UUID.randomUUID(), user, "pilot", "教材书籍", null, null, "1".repeat(64), e);
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), user, "pilot", "教材书籍", null, null, "2".repeat(64), e))
                .as("同一版本第二条启用订阅").isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), user, "pilot", "教材书籍", null, null, "3".repeat(64), foreign))
                .as("版本属于另一所学校").isInstanceOf(DataIntegrityViolationException.class);
        String e2 = edition("pilot", randomIsbn());
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), user, "pilot", "数码电子", null, null, "4".repeat(64), e2))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), user, "pilot", "教材书籍", "高数", "高数", "5".repeat(64), e2))
                .as("教材版本订阅不带关键词").isInstanceOf(DataIntegrityViolationException.class);

        UUID sub = jdbc.queryForObject("SELECT id FROM demand_subscriptions WHERE textbook_edition_id=?", UUID.class, e);
        UUID product = product("教材书籍", "东校区");
        jdbc.update("INSERT INTO demand_matches(id,subscription_id,product_id,score,reason_codes) VALUES (?,?,?,90,ARRAY['TEXTBOOK_EXACT','CATEGORY'])",
                UUID.randomUUID(), sub, product);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO demand_matches(id,subscription_id,product_id,score,reason_codes) VALUES (?,?,?,90,ARRAY['TITLE_SIMILAR'])",
                UUID.randomUUID(), sub, product(("教材书籍"), "东校区"))).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("8. 演示种子：全部标记 is_demo、课程名带「演示课程」、教师为「演示教师」、演示教材全部无 ISBN（4.8：不再占用 979-0 乐谱号段）；无 ISBN 指纹与 Java 实现一致")
    void seedDataIsHonestDemoData() throws java.sql.SQLException {
        // 只看迁移植入的 demo- 行（同库的其他用例会自行插入非演示数据）
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses WHERE id LIKE 'demo-%'", Integer.class)).isEqualTo(5);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses WHERE id LIKE 'demo-%' AND (NOT is_demo OR name NOT LIKE '演示课程%')", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_offerings WHERE id LIKE 'demo-%' AND instructor_name IS NOT NULL AND instructor_name NOT LIKE '演示教师%'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_editions WHERE id LIKE 'demo-%' AND (NOT is_demo OR normalized_isbn IS NOT NULL OR isbn13 IS NOT NULL OR isbn10 IS NOT NULL OR no_isbn_fingerprint IS NULL)", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM textbook_editions WHERE normalized_isbn LIKE '9790%'", Integer.class)).as("没有任何 ISMN 被当作书号").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM product_textbook_details WHERE isbn_snapshot LIKE '9790%'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_textbooks WHERE course_offering_id LIKE 'demo-%' AND source_note NOT LIKE '演示数据%'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_textbooks WHERE course_offering_id LIKE 'demo-%' AND verification_status <> 'VERIFIED'", Integer.class)).isZero();

        // V6 的讲义与 V7 修正的 5 个演示版本：指纹都由同一个 Java 实现复算得到
        for (var notes : jdbc.queryForList("SELECT id, title, authors, publisher, edition_label, published_year, no_isbn_fingerprint "
                + "FROM textbook_editions WHERE id LIKE 'demo-%'")) {
            List<String> authors = List.of((String[]) ((java.sql.Array) notes.get("authors")).getArray());
            String expected = TextbookFingerprint.of((String) notes.get("title"), authors, (String) notes.get("publisher"),
                    (String) notes.get("edition_label"), (Integer) notes.get("published_year"));
            assertThat(notes.get("no_isbn_fingerprint")).as(String.valueOf(notes.get("id"))).isEqualTo(expected);
        }
    }
}
