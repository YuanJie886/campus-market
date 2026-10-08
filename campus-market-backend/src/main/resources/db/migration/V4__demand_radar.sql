-- =============================================================================
-- V4 · 需求雷达：需求订阅与匹配记录
--
-- 背景：普通求购帖是「发出去等人看见」，卖家要主动翻帖才会知道有人想要。
-- 需求雷达反过来：买家把条件存成订阅，任何一件新商品发布时，服务端在同一个事务里
-- 用这些条件去匹配，命中就留下一条匹配记录——买家打开收件箱即可看到。
--
-- 匹配记录本身就是通知，不另建通知表：一条「谁的哪个订阅命中了哪件商品」
-- 已经包含了通知需要的全部信息，再复制一份只会带来两份状态如何同步的问题。
--
-- 隐私边界：卖家侧没有任何读取这两张表的接口。订阅属于买家，
-- 卖家既看不到谁订阅了，也看不到有多少人订阅——后者会被用来试探需求、抬高报价。
--
-- 本阶段不实现「热门型号排队」：没有独占通知窗口、响应期限与递补规则之前，
-- 任何「你排在第 N 位」都是虚构的，因此表结构里刻意没有队列位置字段。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V5。
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. 为复合外键补充唯一约束
--
-- 下面两条让「校区属于学校」「楼栋属于校区」由数据库而不是只由服务层保证：
-- 订阅引用的校区不可能来自另一所学校，引用的楼栋也不可能来自另一个校区。
-- 两张表都是只有十几行的参考数据，额外的唯一索引几乎没有成本。
-- ----------------------------------------------------------------------------

ALTER TABLE campuses  ADD CONSTRAINT campuses_id_school_key  UNIQUE (id, school_id);
ALTER TABLE buildings ADD CONSTRAINT buildings_id_campus_key UNIQUE (id, campus_id);


-- 一栋已停用的演示楼栋。
-- 用于演示与测试「停用楼栋不可再被选择，但仍能被旧数据引用」这条规则；
-- 前端 Mock 的楼栋数据与此逐条一致（src/data/buildings.ts）。
-- 同 V3 一样是虚构的演示数据。
INSERT INTO buildings(id, campus_id, zone, name, latitude, longitude, active, sort_order)
VALUES ('east-songyuan-6', '东校区', '松园', '6号楼', 31.00180, 121.00420, false, 6);


-- ----------------------------------------------------------------------------
-- 1. demand_subscriptions：需求订阅
-- ----------------------------------------------------------------------------

CREATE TABLE demand_subscriptions (
    id                 uuid PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES users(id),
    -- 学校由服务端从用户所在校区推导，客户端无法指定
    school_id          text NOT NULL REFERENCES schools(id),
    -- 用户输入的关键词（仅做首尾去空白），用于原样展示
    keyword            text,
    -- 规范化关键词：小写、连续空白折叠为单个空格。匹配只用这一列
    normalized_keyword text CHECK (normalized_keyword IS NULL
                                   OR length(normalized_keyword) BETWEEN 1 AND 40),
    category           text,
    min_price          numeric(12,2) CHECK (min_price IS NULL OR min_price >= 0),
    max_price          numeric(12,2) CHECK (max_price IS NULL OR max_price >= 0),
    geo_scope          text NOT NULL CHECK (geo_scope IN ('BUILDING','ZONE','CAMPUS','SCHOOL')),
    campus_id          text,
    -- BUILDING / ZONE 的锚点楼栋。ZONE 的园区由这栋楼推导，不接受客户端传入的园区文本
    building_id        text,
    -- 服务端对规范化条件计算的 SHA-256，用于幂等订阅。不含用户身份与任何秘密
    fingerprint        text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    active             boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- 校区必须属于订阅所在学校
    FOREIGN KEY (campus_id, school_id)   REFERENCES campuses(id, school_id),
    -- 锚点楼栋必须属于订阅所记录的校区
    FOREIGN KEY (building_id, campus_id) REFERENCES buildings(id, campus_id),

    CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price),
    -- 至少要有关键词或分类之一，否则「全校任何东西」会让每件商品都通知每个人
    CHECK (normalized_keyword IS NOT NULL OR category IS NOT NULL),
    -- 原文与规范化关键词必须同时存在或同时为空
    CHECK ((keyword IS NULL) = (normalized_keyword IS NULL)),
    -- 每种范围需要且只需要对应的锚点
    CHECK (
        (geo_scope = 'SCHOOL'               AND campus_id IS NULL     AND building_id IS NULL)
     OR (geo_scope = 'CAMPUS'               AND campus_id IS NOT NULL AND building_id IS NULL)
     OR (geo_scope IN ('ZONE', 'BUILDING')  AND campus_id IS NOT NULL AND building_id IS NOT NULL)
    ),
    CHECK (updated_at >= created_at)
);

-- 幂等订阅：同一用户的相同条件只能有一条<b>启用中</b>的订阅。
-- 只约束 active：停用后的历史订阅不占位，同样的条件可以重新激活或再次订阅。
CREATE UNIQUE INDEX demand_subscriptions_active_fingerprint
    ON demand_subscriptions(user_id, fingerprint) WHERE active;

-- 「我的订阅」列表（含已停用）
CREATE INDEX demand_subscriptions_user_created ON demand_subscriptions(user_id, created_at DESC);

-- 商品发布时的候选查询：先按学校 + 分类收敛，再逐条比对关键词与价格。
-- 部分索引只覆盖启用中的订阅，停用的订阅不参与匹配也不占索引空间。
CREATE INDEX demand_subscriptions_match_category
    ON demand_subscriptions(school_id, category) WHERE active;
-- 地理范围的两个锚点，供 BUILDING / ZONE / CAMPUS 的候选收敛
CREATE INDEX demand_subscriptions_match_building
    ON demand_subscriptions(building_id) WHERE active;
CREATE INDEX demand_subscriptions_match_campus
    ON demand_subscriptions(campus_id) WHERE active;


-- ----------------------------------------------------------------------------
-- 2. demand_matches：匹配记录（即通知）
-- ----------------------------------------------------------------------------

CREATE TABLE demand_matches (
    id              uuid PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES demand_subscriptions(id),
    product_id      uuid NOT NULL REFERENCES products(id),
    -- 0～100 的确定性评分，规则见 docs/demand-radar.md
    score           integer NOT NULL CHECK (score BETWEEN 0 AND 100),
    -- 与评分一一对应的理由码。只允许已知的稳定英文常量，中文只在前端映射
    reason_codes    text[] NOT NULL CHECK (
                        cardinality(reason_codes) >= 1
                        AND reason_codes <@ ARRAY[
                            'KEYWORD_TITLE_EXACT', 'KEYWORD_TITLE', 'KEYWORD_DESCRIPTION',
                            'CATEGORY', 'SAME_BUILDING', 'SAME_ZONE', 'SAME_CAMPUS', 'PRICE_CLOSE'
                        ]::text[]),
    read_at         timestamptz,
    dismissed_at    timestamptz,
    -- 商品编辑后不再满足条件、或被下架 / 售出时写入；重新满足时清空
    invalidated_at  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    -- 同一订阅对同一商品只有一条记录：重复发布或多次编辑都不会产生重复通知
    UNIQUE (subscription_id, product_id),
    CHECK (read_at        IS NULL OR read_at        >= created_at),
    CHECK (dismissed_at   IS NULL OR dismissed_at   >= created_at),
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

-- 商品编辑 / 状态变化时按商品找回全部匹配
CREATE INDEX demand_matches_product ON demand_matches(product_id);
-- 收件箱按时间倒序列出
CREATE INDEX demand_matches_subscription_created ON demand_matches(subscription_id, created_at DESC);
-- 未读数：只索引「仍有效、未读、未忽略」的行，已处理的记录不进这个索引
CREATE INDEX demand_matches_unread ON demand_matches(subscription_id)
    WHERE read_at IS NULL AND dismissed_at IS NULL AND invalidated_at IS NULL;
