-- =============================================================================
-- V6 · 课程教材图谱核心版（模块 4）
--
-- 解决的问题：学生知道「课程名 / 书名 / ISBN」，却无法确认二手商品是不是老师要求的那个版本。
-- 核心关系：学校 → 课程 → 学期开课 → 指定教材版本 → 本校在售商品 → 无货时精确版本订阅。
--
-- 边界：
--   * 不依赖、不模拟学校课程表接口；不存学生名单、选课记录、班级成员、课表时间或教室。
--   * 教师只是开课的公开文字标签，不建立教师账号、不存联系方式。
--   * 教材版本以 ISBN 精确区分；不用书名相似度猜版本，不把不同版次合并成一本。
--   * 没有管理员系统：只有迁移写入的演示数据是 VERIFIED；普通用户的建议进入单独的
--     textbook_suggestions，永远是 PENDING / WITHDRAWN，不会自动变成公开数据。
--   * 教材目录按学校划分（(id, school_id) 复合外键）：跨学校的课程—教材关系、
--     商品—教材关联、教材订阅都由数据库直接拒绝，而不只依赖服务层。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V7。
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. ISBN 校验函数（IMMUTABLE，可用于 CHECK）
--
-- 服务层 Isbn.java 与前端 utils/isbn.ts 是同一套规则；数据库这一层保证即使绕过服务层
-- 直接写 SQL，校验位错误的号码也进不来。
-- ----------------------------------------------------------------------------

CREATE FUNCTION isbn13_is_valid(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT v ~ '^97[89][0-9]{10}$'
       AND (SELECT sum(substr(v, i, 1)::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END)
            FROM generate_series(1, 13) AS i) % 10 = 0
$$;

CREATE FUNCTION isbn10_is_valid(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT v ~ '^[0-9]{9}[0-9X]$'
       AND (SELECT sum(CASE WHEN substr(v, i, 1) = 'X' THEN 10 ELSE substr(v, i, 1)::int END * (11 - i))
            FROM generate_series(1, 10) AS i) % 11 = 0
$$;

-- ISBN-10 → ISBN-13：前缀 978 + 前 9 位 + 重新计算的 EAN 校验位
CREATE FUNCTION isbn10_to_isbn13(v text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT body || ((10 - (SELECT sum(substr(body, i, 1)::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END)
                           FROM generate_series(1, 12) AS i) % 10) % 10)::text
    FROM (SELECT '978' || substr(v, 1, 9) AS body) AS b
$$;


-- ----------------------------------------------------------------------------
-- 1. courses：课程（属于学校）
-- ----------------------------------------------------------------------------

CREATE TABLE courses (
    id              text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    school_id       text NOT NULL REFERENCES schools(id),
    -- 课程代码可空；有则规范化为大写
    course_code     text CHECK (course_code IS NULL OR course_code ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
    name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND name !~ '[<>]'),
    -- 规范化名称：小写、空白折叠、去首尾空白。由服务端（DemandText.normalize 同一规则）计算
    normalized_name text NOT NULL CHECK (normalized_name <> ''
                                         AND normalized_name = btrim(normalized_name)
                                         AND normalized_name = lower(normalized_name)),
    department      text CHECK (department IS NULL OR (length(department) <= 60 AND department !~ '[<>]')),
    -- 演示数据标记：界面据此显示「演示目录」，不冒充学校教务数据
    is_demo         boolean NOT NULL DEFAULT false,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    -- 供复合外键使用：开课只能引用本校课程
    UNIQUE (id, school_id),
    -- 同一学校规范化名称防重复
    UNIQUE (school_id, normalized_name)
);

CREATE UNIQUE INDEX courses_school_code ON courses(school_id, course_code) WHERE course_code IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 2. course_offerings：学期开课
-- ----------------------------------------------------------------------------

CREATE TABLE course_offerings (
    id              text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    course_id       text NOT NULL,
    school_id       text NOT NULL,
    -- 学年：YYYY-YYYY，后一年必须紧接前一年
    academic_year   text NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'
                                         AND substr(academic_year, 6, 4)::int = substr(academic_year, 1, 4)::int + 1),
    term            text NOT NULL CHECK (term IN ('SPRING', 'SUMMER', 'AUTUMN', 'WINTER')),
    -- 仅是开课的公开文字标签，不关联任何账号，不含联系方式
    instructor_name text CHECK (instructor_name IS NULL
                                OR (length(btrim(instructor_name)) BETWEEN 1 AND 40 AND instructor_name !~ '[<>@0-9]')),
    campus_id       text,
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (course_id, school_id) REFERENCES courses(id, school_id),
    -- 开课校区必须属于课程所在学校
    FOREIGN KEY (campus_id, school_id) REFERENCES campuses(id, school_id),
    UNIQUE (id, school_id)
);

-- 同课程、学年、学期、教师标签防止明显重复（教师为空视为同一个空标签）
CREATE UNIQUE INDEX course_offerings_dedupe
    ON course_offerings(course_id, academic_year, term, COALESCE(instructor_name, ''));


-- ----------------------------------------------------------------------------
-- 3. textbook_editions：教材版本（学校教材目录）
-- ----------------------------------------------------------------------------

CREATE TABLE textbook_editions (
    id                  text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    school_id           text NOT NULL REFERENCES schools(id),
    isbn10              text CHECK (isbn10 IS NULL OR isbn10_is_valid(isbn10)),
    isbn13              text CHECK (isbn13 IS NULL OR isbn13_is_valid(isbn13)),
    -- 规范化 ISBN：一律存 ISBN-13（ISBN-10 转换而来），去掉连字符与空格
    normalized_isbn     text CHECK (normalized_isbn IS NULL OR isbn13_is_valid(normalized_isbn)),
    title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120 AND title !~ '[<>]'),
    subtitle            text CHECK (subtitle IS NULL OR (length(subtitle) <= 120 AND subtitle !~ '[<>]')),
    authors             text[] NOT NULL CHECK (cardinality(authors) BETWEEN 1 AND 10),
    publisher           text NOT NULL CHECK (length(btrim(publisher)) BETWEEN 1 AND 80 AND publisher !~ '[<>]'),
    -- 版次标签，如「第 8 版」。不同版次是不同的行，永不合并
    edition_label       text NOT NULL CHECK (length(btrim(edition_label)) BETWEEN 1 AND 40 AND edition_label !~ '[<>]'),
    published_year      integer CHECK (published_year IS NULL OR published_year BETWEEN 1900 AND 2100),
    -- 只允许 https，拒绝 javascript: / data: 等任意协议
    cover_url           text CHECK (cover_url IS NULL OR cover_url ~ '^https://[^[:space:]<>"'']{1,2000}$'),
    -- 同一部教材不同版次的人工整理分组键（目录数据，不是由书名推断）。「其他版本」只看这个键
    work_key            text CHECK (work_key IS NULL OR work_key ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    -- 没有 ISBN 的教材用元数据指纹防明显重复（书名 + 作者 + 出版社 + 版次 + 年份），由服务端计算
    no_isbn_fingerprint text CHECK (no_isbn_fingerprint IS NULL OR no_isbn_fingerprint ~ '^[0-9a-f]{64}$'),
    is_demo             boolean NOT NULL DEFAULT false,
    active              boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    -- 要么有 ISBN，要么有无 ISBN 指纹，二者恰好其一
    CHECK ((normalized_isbn IS NULL) <> (no_isbn_fingerprint IS NULL)),
    -- 三个 ISBN 字段必须互相一致
    CHECK (isbn13 IS NULL OR normalized_isbn = isbn13),
    CHECK (isbn10 IS NULL OR normalized_isbn = isbn10_to_isbn13(isbn10)),
    CHECK (normalized_isbn IS NULL OR isbn13 IS NOT NULL OR isbn10 IS NOT NULL),
    UNIQUE (id, school_id)
);

-- 同一学校目录内，同一 ISBN 只有一个版本
CREATE UNIQUE INDEX textbook_editions_school_isbn
    ON textbook_editions(school_id, normalized_isbn) WHERE normalized_isbn IS NOT NULL;
CREATE UNIQUE INDEX textbook_editions_school_fingerprint
    ON textbook_editions(school_id, no_isbn_fingerprint) WHERE no_isbn_fingerprint IS NOT NULL;
CREATE INDEX textbook_editions_work ON textbook_editions(school_id, work_key) WHERE work_key IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 4. course_textbooks：开课 ↔ 教材版本
-- ----------------------------------------------------------------------------

CREATE TABLE course_textbooks (
    course_offering_id  text NOT NULL,
    textbook_edition_id text NOT NULL,
    school_id           text NOT NULL,
    usage_type          text NOT NULL CHECK (usage_type IN ('REQUIRED', 'RECOMMENDED', 'REFERENCE')),
    -- 公开目录只展示 VERIFIED。PENDING / REJECTED 预留给将来的可信审核入口，本阶段没有写入路径
    verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED', 'PENDING', 'REJECTED')),
    source_note         text CHECK (source_note IS NULL OR (length(source_note) <= 200 AND source_note !~ '[<>]')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_offering_id, textbook_edition_id),
    -- 两端必须属于同一学校
    FOREIGN KEY (course_offering_id, school_id) REFERENCES course_offerings(id, school_id),
    FOREIGN KEY (textbook_edition_id, school_id) REFERENCES textbook_editions(id, school_id)
);

-- 教材详情反查课程：只索引公开的 VERIFIED 关系
CREATE INDEX course_textbooks_edition_verified
    ON course_textbooks(textbook_edition_id) WHERE verification_status = 'VERIFIED';


-- ----------------------------------------------------------------------------
-- 5. textbook_suggestions：普通用户的教材建议（永不自动公开）
-- ----------------------------------------------------------------------------

CREATE TABLE textbook_suggestions (
    id                  uuid PRIMARY KEY,
    submitter_id        uuid NOT NULL REFERENCES users(id),
    -- 由服务端从提交人所在校区推导
    school_id           text NOT NULL REFERENCES schools(id),
    course_offering_id  text NOT NULL,
    -- 二选一：目录中已有的版本，或待审核的元数据（至少给 ISBN 或书名）
    textbook_edition_id text,
    isbn13              text CHECK (isbn13 IS NULL OR isbn13_is_valid(isbn13)),
    title               text CHECK (title IS NULL OR (length(btrim(title)) BETWEEN 1 AND 120 AND title !~ '[<>]')),
    authors             text CHECK (authors IS NULL OR (length(authors) <= 120 AND authors !~ '[<>]')),
    publisher           text CHECK (publisher IS NULL OR (length(publisher) <= 80 AND publisher !~ '[<>]')),
    edition_label       text CHECK (edition_label IS NULL OR (length(edition_label) <= 40 AND edition_label !~ '[<>]')),
    published_year      integer CHECK (published_year IS NULL OR published_year BETWEEN 1900 AND 2100),
    usage_type          text NOT NULL CHECK (usage_type IN ('REQUIRED', 'RECOMMENDED', 'REFERENCE')),
    note                text CHECK (note IS NULL OR (length(note) <= 200 AND note !~ '[<>]')),
    -- 只有「待审核」和「已撤回」。没有 VERIFIED：本阶段不存在任何能让建议变成公开数据的路径
    status              text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'WITHDRAWN')),
    fingerprint         text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    created_at          timestamptz NOT NULL DEFAULT now(),
    withdrawn_at        timestamptz,
    FOREIGN KEY (course_offering_id, school_id) REFERENCES course_offerings(id, school_id),
    FOREIGN KEY (textbook_edition_id, school_id) REFERENCES textbook_editions(id, school_id),
    CHECK (textbook_edition_id IS NOT NULL OR isbn13 IS NOT NULL OR title IS NOT NULL),
    CHECK (textbook_edition_id IS NULL OR (isbn13 IS NULL AND title IS NULL AND authors IS NULL
                                           AND publisher IS NULL AND edition_label IS NULL AND published_year IS NULL)),
    CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
    CHECK (withdrawn_at IS NULL OR withdrawn_at >= created_at)
);

-- 同一用户的相同建议（待审核中）只有一条：重复提交幂等
CREATE UNIQUE INDEX textbook_suggestions_pending_dedupe
    ON textbook_suggestions(submitter_id, fingerprint) WHERE status = 'PENDING';
CREATE INDEX textbook_suggestions_submitter ON textbook_suggestions(submitter_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- 6. product_textbook_details：商品 ↔ 教材版本（至多一个）
-- ----------------------------------------------------------------------------

CREATE TABLE product_textbook_details (
    product_id          uuid PRIMARY KEY REFERENCES products(id),
    school_id           text NOT NULL,
    textbook_edition_id text NOT NULL,
    -- 关联当时的展示快照：目录日后修订，商品页仍显示卖家确认时看到的版本信息
    isbn_snapshot       text CHECK (isbn_snapshot IS NULL OR isbn13_is_valid(isbn_snapshot)),
    title_snapshot      text NOT NULL CHECK (length(title_snapshot) BETWEEN 1 AND 120),
    edition_snapshot    text NOT NULL CHECK (length(edition_snapshot) BETWEEN 1 AND 40),
    publisher_snapshot  text NOT NULL CHECK (length(publisher_snapshot) BETWEEN 1 AND 80),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    FOREIGN KEY (textbook_edition_id, school_id) REFERENCES textbook_editions(id, school_id)
);

CREATE INDEX product_textbook_details_edition ON product_textbook_details(textbook_edition_id);

-- 只有教材类商品能关联；商品所在学校必须与教材目录的学校一致；
-- 版本不变时快照不可改写（快照只在卖家重新选择版本时整体替换）
CREATE FUNCTION product_textbook_details_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    product_category text;
    product_school   text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.product_id <> OLD.product_id THEN
            RAISE EXCEPTION 'product_id 不可修改' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.textbook_edition_id = OLD.textbook_edition_id
           AND (NEW.isbn_snapshot IS DISTINCT FROM OLD.isbn_snapshot
                OR NEW.title_snapshot <> OLD.title_snapshot
                OR NEW.edition_snapshot <> OLD.edition_snapshot
                OR NEW.publisher_snapshot <> OLD.publisher_snapshot) THEN
            RAISE EXCEPTION '教材版本未变化时快照不可改写' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    SELECT p.category, c.school_id INTO product_category, product_school
    FROM products p JOIN campuses c ON c.id = p.campus
    WHERE p.id = NEW.product_id;
    IF product_category IS DISTINCT FROM '教材书籍' THEN
        RAISE EXCEPTION '只有教材书籍类商品可以关联教材版本' USING ERRCODE = 'check_violation';
    END IF;
    IF product_school IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION '商品与教材版本不属于同一学校' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER product_textbook_details_guard
    BEFORE INSERT OR UPDATE ON product_textbook_details
    FOR EACH ROW EXECUTE FUNCTION product_textbook_details_guard();

-- 反方向：已关联教材的商品不能被改成非教材分类或换到别的学校的校区（服务层会先解除关联）
CREATE FUNCTION products_textbook_link_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    linked_school text;
BEGIN
    SELECT school_id INTO linked_school FROM product_textbook_details WHERE product_id = NEW.id;
    IF linked_school IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.category <> '教材书籍' THEN
        RAISE EXCEPTION '已关联教材版本的商品不能改为其他分类，请先解除关联' USING ERRCODE = 'check_violation';
    END IF;
    IF (SELECT school_id FROM campuses WHERE id = NEW.campus) IS DISTINCT FROM linked_school THEN
        RAISE EXCEPTION '已关联教材版本的商品不能换到其他学校的校区' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER products_textbook_link_guard
    BEFORE UPDATE OF category, campus ON products
    FOR EACH ROW EXECUTE FUNCTION products_textbook_link_guard();


-- ----------------------------------------------------------------------------
-- 7. 需求雷达联动：精确教材版本订阅（通过 ALTER 演进 V4，不修改 V4）
-- ----------------------------------------------------------------------------

ALTER TABLE demand_subscriptions ADD COLUMN textbook_edition_id text;
-- 订阅的教材版本必须属于订阅所在学校
ALTER TABLE demand_subscriptions ADD CONSTRAINT demand_subscriptions_textbook_school_fkey
    FOREIGN KEY (textbook_edition_id, school_id) REFERENCES textbook_editions(id, school_id);
-- 精确版本订阅：分类固定为教材书籍，不带关键词（按版本匹配，不按书名匹配）
ALTER TABLE demand_subscriptions ADD CONSTRAINT demand_subscriptions_textbook_shape
    CHECK (textbook_edition_id IS NULL OR (category = '教材书籍' AND normalized_keyword IS NULL));

-- 同一用户同一教材版本只能有一条启用中的订阅
CREATE UNIQUE INDEX demand_subscriptions_active_textbook
    ON demand_subscriptions(user_id, textbook_edition_id)
    WHERE active AND textbook_edition_id IS NOT NULL;
-- 商品关联教材时的候选收敛：按版本 id 精确取回
CREATE INDEX demand_subscriptions_match_textbook
    ON demand_subscriptions(textbook_edition_id) WHERE active AND textbook_edition_id IS NOT NULL;
-- 普通订阅（没有教材版本）的「学校 + 分类」收敛。V4 的 demand_subscriptions_match_category
-- 同时覆盖教材版本订阅；一所学校的教材订阅多了以后，每发布一件教材商品都会把它们逐条扫一遍。
-- 这条部分索引把教材版本订阅排除在外（TextbookPerformanceIT 用执行计划验证）。
CREATE INDEX demand_subscriptions_match_plain
    ON demand_subscriptions(school_id, category) WHERE active AND textbook_edition_id IS NULL;

-- 理由码约束升级：新增 TEXTBOOK_EXACT。V4 的约束是列级内联 CHECK（系统命名），
-- 这里按定义内容找到它再替换，不依赖自动生成的名字。
DO $$
DECLARE
    legacy text;
BEGIN
    SELECT conname INTO legacy
    FROM pg_constraint
    WHERE conrelid = 'demand_matches'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%KEYWORD_TITLE_EXACT%';
    IF legacy IS NULL THEN
        RAISE EXCEPTION 'V6: 找不到 demand_matches 的理由码约束';
    END IF;
    EXECUTE format('ALTER TABLE demand_matches DROP CONSTRAINT %I', legacy);
END $$;

ALTER TABLE demand_matches ADD CONSTRAINT demand_matches_reason_codes_known CHECK (
    cardinality(reason_codes) >= 1
    AND reason_codes <@ ARRAY[
        'TEXTBOOK_EXACT',
        'KEYWORD_TITLE_EXACT', 'KEYWORD_TITLE', 'KEYWORD_DESCRIPTION',
        'CATEGORY', 'SAME_BUILDING', 'SAME_ZONE', 'SAME_CAMPUS', 'PRICE_CLOSE'
    ]::text[]);


-- ----------------------------------------------------------------------------
-- 8. 演示数据（虚构，明确标记 is_demo）
--
-- 不代表任何真实学校，不来自任何教务系统；课程名带「演示课程」前缀，教师为「演示教师」。
-- 演示 ISBN 使用 979-0 前缀：该号段分配给乐谱（ISMN），不会与任何真实图书书号重合，
-- 同时校验位完全合法，便于演示规范化与校验流程。
-- 升级不为任何既有商品猜测教材版本，也不生成任何用户的选课或订阅记录。
-- ----------------------------------------------------------------------------

INSERT INTO courses(id, school_id, course_code, name, normalized_name, department, is_demo) VALUES
  ('demo-calculus-1',    'pilot', 'DEMO-MA101', '演示课程·微积分（一）',   '演示课程·微积分（一）',   '演示数学学院',   true),
  ('demo-linear-algebra','pilot', 'DEMO-MA102', '演示课程·线性代数',       '演示课程·线性代数',       '演示数学学院',   true),
  ('demo-physics-1',     'pilot', 'DEMO-PH101', '演示课程·大学物理（上）', '演示课程·大学物理（上）', '演示物理学院',   true),
  ('demo-programming',   'pilot', 'DEMO-CS101', '演示课程·程序设计基础',   '演示课程·程序设计基础',   '演示计算机学院', true),
  ('demo-academic-en',   'pilot', 'DEMO-EN101', '演示课程·学术英语写作',   '演示课程·学术英语写作',   '演示外国语学院', true);

INSERT INTO course_offerings(id, course_id, school_id, academic_year, term, instructor_name, campus_id) VALUES
  ('demo-calculus-1-2025s',     'demo-calculus-1',     'pilot', '2025-2026', 'SPRING', '演示教师甲', '东校区'),
  ('demo-calculus-1-2026a',     'demo-calculus-1',     'pilot', '2026-2027', 'AUTUMN', '演示教师甲', '东校区'),
  ('demo-linear-algebra-2026a', 'demo-linear-algebra', 'pilot', '2026-2027', 'AUTUMN', '演示教师乙', '西校区'),
  ('demo-physics-1-2026a',      'demo-physics-1',      'pilot', '2026-2027', 'AUTUMN', '演示教师丙', '东校区'),
  ('demo-programming-2026a',    'demo-programming',    'pilot', '2026-2027', 'AUTUMN', NULL,         NULL),
  ('demo-academic-en-2026a',    'demo-academic-en',    'pilot', '2026-2027', 'AUTUMN', '演示教师丁', '南校区');

INSERT INTO textbook_editions(id, school_id, isbn13, normalized_isbn, title, authors, publisher, edition_label,
                              published_year, work_key, no_isbn_fingerprint, is_demo) VALUES
  ('demo-calculus-7',        'pilot', '9790000001015', '9790000001015', '微积分教程（演示）',     ARRAY['演示作者甲'], '演示大学出版社', '第 7 版', 2023, 'demo-calculus',  NULL, true),
  ('demo-calculus-8',        'pilot', '9790000001022', '9790000001022', '微积分教程（演示）',     ARRAY['演示作者甲'], '演示大学出版社', '第 8 版', 2025, 'demo-calculus',  NULL, true),
  ('demo-linear-algebra-3',  'pilot', '9790000002012', '9790000002012', '线性代数导论（演示）',   ARRAY['演示作者乙', '演示作者丙'], '演示科技出版社', '第 3 版', 2024, 'demo-linear-algebra', NULL, true),
  ('demo-physics-5',         'pilot', '9790000003019', '9790000003019', '大学物理（演示）· 上册', ARRAY['演示作者丁'], '演示大学出版社', '第 5 版', 2022, 'demo-physics', NULL, true),
  ('demo-programming-2',     'pilot', '9790000004016', '9790000004016', '程序设计基础（演示）',   ARRAY['演示作者戊'], '演示科技出版社', '第 2 版', 2024, NULL, NULL, true),
  -- 没有 ISBN 的演示教材（讲义类）：用元数据指纹防重复。指纹由服务端 TextbookFingerprint 同一算法得出，
  -- 这里写入固定值，TextbookCatalogIT 会用 Java 实现重新计算并比对
  ('demo-academic-en-notes', 'pilot', NULL, NULL, '学术英语写作讲义（演示）', ARRAY['演示作者己'], '演示外国语学院（自编）', '2026 秋季版', 2026, NULL,
   '0e545530b8a179820bb31f0df6a5927c93106a0da338d36670439b4ff8f3e48a', true);

INSERT INTO course_textbooks(course_offering_id, textbook_edition_id, school_id, usage_type, verification_status, source_note) VALUES
  ('demo-calculus-1-2025s',     'demo-calculus-7',        'pilot', 'REQUIRED',    'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-calculus-1-2026a',     'demo-calculus-8',        'pilot', 'REQUIRED',    'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-calculus-1-2026a',     'demo-calculus-7',        'pilot', 'REFERENCE',   'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-linear-algebra-2026a', 'demo-linear-algebra-3',  'pilot', 'REQUIRED',    'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-physics-1-2026a',      'demo-physics-5',         'pilot', 'REQUIRED',    'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-programming-2026a',    'demo-programming-2',     'pilot', 'RECOMMENDED', 'VERIFIED', '演示数据：虚构，不来自任何学校教务系统'),
  ('demo-academic-en-2026a',    'demo-academic-en-notes', 'pilot', 'REQUIRED',    'VERIFIED', '演示数据：虚构，不来自任何学校教务系统');
