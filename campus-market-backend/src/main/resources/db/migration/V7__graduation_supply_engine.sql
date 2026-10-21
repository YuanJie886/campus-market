-- =============================================================================
-- V7 · 毕业季通用供给引擎（模块 5）+ 模块 4.8 演示教材标识修正
--
-- 适用于全部商品分类，不是教材专用：
--   * 服务端发布草稿（乐观锁、软丢弃、过期状态）；
--   * 批量发布（最多 20 件，全有或全无，整体幂等）；
--   * 整套打包商品（一个商品主体 + 2～30 条明细，仍然只生成一个订单）；
--   * 协助整理发布（一次性邀请，只存 token 哈希；协助人不能发布，最终由所有者发布）；
--   * 订单成交价快照（价格参考只统计有可信快照的已完成订单）。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V8。
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. 模块 4.8：演示教材不再占用 979-0（ISMN，乐谱号）号段冒充图书 ISBN
--
-- 只修正 V6 植入的五条演示教材：按 id + is_demo + 学校 + 原号码 + 书名 + 版次六项精确匹配，
-- 改为「无 ISBN」并使用由书目信息计算的稳定指纹（与 TextbookFingerprint 同一算法，
-- TextbookSchemaIT 会用 Java 实现重新计算并比对）。其他任何教材行（包括用户数据）不受影响。
-- V6 的 isbn13_is_valid 函数保持原样：重新定义它会让任何已含该号段的行在下一次 UPDATE 时
-- 触发 CHECK 失败；「ISMN 不是 ISBN」的规则在服务端与前端的 ISBN 解析中执行。
-- ----------------------------------------------------------------------------

UPDATE textbook_editions AS e
SET isbn13 = NULL, normalized_isbn = NULL, no_isbn_fingerprint = v.fingerprint, updated_at = now()
FROM (VALUES
    ('demo-calculus-7',       '9790000001015', '微积分教程（演示）',     '第 7 版', 'b0491ddffbdf8df07787d72771ac230a9cf46a8e0d94a7fe002a58134b75a096'),
    ('demo-calculus-8',       '9790000001022', '微积分教程（演示）',     '第 8 版', 'a6abb0d95ac7ff36b652e3b78bc3d38379c78cfc0128cdc1bb2f25ba94da0652'),
    ('demo-linear-algebra-3', '9790000002012', '线性代数导论（演示）',   '第 3 版', '0c2a02ec3f98cd15327a6a01bbbdeb2ead22db43f01f61c39150ab908abc1dc4'),
    ('demo-physics-5',        '9790000003019', '大学物理（演示）· 上册', '第 5 版', '87ebdb39e2f952f25b8e6ec44fab0d4b2c00ec6fac1d94b9df102d7bb9fa18f3'),
    ('demo-programming-2',    '9790000004016', '程序设计基础（演示）',   '第 2 版', '7d069ad9d545052de74e34f277f4b1b44a6018c2a03f4800dabf76b02d715fd6')
) AS v(id, old_isbn, title, edition_label, fingerprint)
WHERE e.id = v.id AND e.is_demo AND e.school_id = 'pilot'
  AND e.normalized_isbn = v.old_isbn AND e.isbn13 = v.old_isbn AND e.isbn10 IS NULL
  AND e.title = v.title AND e.edition_label = v.edition_label;

-- 已关联这些演示版本的商品快照里同样去掉 979-0 号码。V6 的快照保护触发器不允许
-- 「版本不变时改写快照」，这里只在本迁移内临时停用它，并且只改这五个演示版本、号码仍是 979-0、
-- 且对应的演示版本确实已在上一步被修正为「无 ISBN」的行（没有精确匹配而保持原样的版本，其快照也保持原样）。
ALTER TABLE product_textbook_details DISABLE TRIGGER product_textbook_details_guard;
UPDATE product_textbook_details AS d
SET isbn_snapshot = NULL, updated_at = now()
WHERE d.textbook_edition_id IN ('demo-calculus-7', 'demo-calculus-8', 'demo-linear-algebra-3', 'demo-physics-5', 'demo-programming-2')
  AND d.isbn_snapshot IN ('9790000001015', '9790000001022', '9790000002012', '9790000003019', '9790000004016')
  AND EXISTS (SELECT 1 FROM textbook_editions e
              WHERE e.id = d.textbook_edition_id AND e.school_id = d.school_id AND e.is_demo AND e.normalized_isbn IS NULL AND e.no_isbn_fingerprint IS NOT NULL);
ALTER TABLE product_textbook_details ENABLE TRIGGER product_textbook_details_guard;


-- ----------------------------------------------------------------------------
-- 1. 商品：单件 / 整套打包；发布人与协助人
-- ----------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN listing_kind text NOT NULL DEFAULT 'SINGLE'
    CHECK (listing_kind IN ('SINGLE', 'BUNDLE'));
-- 最终点击发布的人：必须就是所有者（协助人不能发布）
ALTER TABLE products ADD COLUMN published_by uuid REFERENCES users(id);
-- 可选：协助整理内容的人。只做记录，不授予任何发布后的权限
ALTER TABLE products ADD COLUMN assisted_by uuid REFERENCES users(id);
ALTER TABLE products ADD CONSTRAINT products_published_by_owner CHECK (published_by IS NULL OR published_by = seller_id);
ALTER TABLE products ADD CONSTRAINT products_assisted_by_not_owner CHECK (assisted_by IS NULL OR assisted_by <> seller_id);

-- 单件 / 打包发布后不可互换：已有订单与验货快照依赖商品的形态
CREATE FUNCTION products_listing_kind_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.listing_kind <> OLD.listing_kind THEN
        RAISE EXCEPTION '商品发布后不能在单件与整套打包之间切换' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER products_listing_kind_guard BEFORE UPDATE OF listing_kind ON products
    FOR EACH ROW EXECUTE FUNCTION products_listing_kind_guard();


-- ----------------------------------------------------------------------------
-- 2. bundle_items：打包明细（不是可单独购买的商品，没有自己的订单）
-- ----------------------------------------------------------------------------

CREATE TABLE bundle_items (
    product_id uuid NOT NULL REFERENCES products(id),
    item_code  text NOT NULL CHECK (item_code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
    name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60 AND name !~ '[<>]'),
    -- 使用现有真实分类与成色，不另造一套
    category   text NOT NULL CHECK (category IN ('数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他')),
    condition  text NOT NULL CHECK (condition IN ('全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹')),
    quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    note       text NOT NULL DEFAULT '' CHECK (length(note) <= 200 AND note !~ '[<>]'),
    sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 29),
    PRIMARY KEY (product_id, item_code),
    -- sort_order 0～29 且唯一：一件打包商品最多 30 条明细
    UNIQUE (product_id, sort_order)
);

-- 明细只能挂在整套打包商品上
CREATE FUNCTION bundle_items_kind_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT listing_kind FROM products WHERE id = NEW.product_id) IS DISTINCT FROM 'BUNDLE' THEN
        RAISE EXCEPTION '只有整套打包商品可以有打包明细' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER bundle_items_kind_guard BEFORE INSERT OR UPDATE ON bundle_items
    FOR EACH ROW EXECUTE FUNCTION bundle_items_kind_guard();

-- 提交时检查：整套打包商品必须有 2～30 条明细（延迟到事务末尾，编辑时整体替换明细不会中途失败）
CREATE FUNCTION bundle_items_count_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pid uuid;
    kind text;
    n integer;
BEGIN
    -- 用 IF 分支而不是 CASE 表达式：PL/pgSQL 会在求值前绑定表达式里的全部记录字段，
    -- 在 products 上触发时 NEW.product_id 并不存在
    IF TG_TABLE_NAME = 'products' THEN
        pid := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        pid := OLD.product_id;
    ELSE
        pid := NEW.product_id;
    END IF;
    SELECT listing_kind INTO kind FROM products WHERE id = pid;
    IF kind = 'BUNDLE' THEN
        SELECT count(*) INTO n FROM bundle_items WHERE product_id = pid;
        IF n < 2 OR n > 30 THEN
            RAISE EXCEPTION '整套打包商品需要 2～30 条明细（当前 % 条）', n USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bundle_items_count_on_items
    AFTER INSERT OR UPDATE OR DELETE ON bundle_items
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bundle_items_count_check();
CREATE CONSTRAINT TRIGGER bundle_items_count_on_products
    AFTER INSERT ON products
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bundle_items_count_check();

-- 打包商品的订单验货模板：不出现在发布页（停用，且分类不是任何真实商品分类），
-- 只作为订单验货快照的来源标识；条目在下单时按每条明细生成（见 InspectionService）
INSERT INTO inspection_templates(id, category, version, title, active)
VALUES ('tpl-bundle-v1', 'BUNDLE', 1, '整套打包验货清单', false);


-- ----------------------------------------------------------------------------
-- 3. listing_drafts：服务端发布草稿
-- ----------------------------------------------------------------------------

CREATE TABLE listing_drafts (
    id                   uuid PRIMARY KEY,
    owner_user_id        uuid NOT NULL REFERENCES users(id),
    -- 最后一次写入的人：所有者本人，或被授权的协助人
    editor_user_id       uuid NOT NULL REFERENCES users(id),
    draft_type           text NOT NULL CHECK (draft_type IN ('SINGLE', 'BUNDLE')),
    -- 经服务端字段白名单过滤后的商品字段（可以不完整）
    payload              jsonb NOT NULL DEFAULT '{}'::jsonb
                         CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536),
    -- 乐观锁：每次写入 +1，客户端必须带上读到的版本
    version              integer NOT NULL DEFAULT 1 CHECK (version > 0),
    status               text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'READY', 'PUBLISHED', 'DISCARDED', 'EXPIRED')),
    expires_at           timestamptz NOT NULL,
    published_product_id uuid REFERENCES products(id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    CHECK ((status = 'PUBLISHED') = (published_product_id IS NOT NULL)),
    UNIQUE (id, owner_user_id)
);

CREATE INDEX listing_drafts_owner_updated ON listing_drafts(owner_user_id, updated_at DESC);

-- 已发布 / 已丢弃 / 已过期的草稿只读；草稿不物理删除
CREATE FUNCTION listing_drafts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '草稿不能被物理删除，请改为丢弃' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('PUBLISHED', 'DISCARDED', 'EXPIRED') THEN
        RAISE EXCEPTION '草稿已发布、已丢弃或已过期，不能再修改' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.owner_user_id <> OLD.owner_user_id OR NEW.draft_type <> OLD.draft_type OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION '草稿的所有者、类型与创建时间不可修改' USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER listing_drafts_guard BEFORE UPDATE OR DELETE ON listing_drafts
    FOR EACH ROW EXECUTE FUNCTION listing_drafts_guard();


-- ----------------------------------------------------------------------------
-- 4. listing_batches / listing_batch_items：批量发布
-- ----------------------------------------------------------------------------

CREATE TABLE listing_batches (
    id            uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES users(id),
    status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PUBLISHED', 'DISCARDED')),
    version       integer NOT NULL DEFAULT 1 CHECK (version > 0),
    published_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)),
    UNIQUE (id, owner_user_id)
);

CREATE INDEX listing_batches_owner_created ON listing_batches(owner_user_id, created_at DESC);

CREATE TABLE listing_batch_items (
    batch_id      uuid NOT NULL,
    draft_id      uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    -- 1～20 且批次内唯一：一个批次最多 20 条
    position      integer NOT NULL CHECK (position BETWEEN 1 AND 20),
    -- 批次仍未发布 / 未丢弃时为 true。用于「同一草稿不能同时属于两个未发布批次」
    active        boolean NOT NULL DEFAULT true,
    product_id    uuid REFERENCES products(id),
    PRIMARY KEY (batch_id, draft_id),
    UNIQUE (batch_id, position),
    -- 批次与草稿必须属于同一个所有者
    FOREIGN KEY (batch_id, owner_user_id) REFERENCES listing_batches(id, owner_user_id),
    FOREIGN KEY (draft_id, owner_user_id) REFERENCES listing_drafts(id, owner_user_id)
);

CREATE UNIQUE INDEX listing_batch_items_one_open_batch ON listing_batch_items(draft_id) WHERE active;

-- 批量发布的幂等记录：同一所有者的同一 Idempotency-Key 只对应一次发布
CREATE TABLE listing_publish_requests (
    owner_user_id   uuid NOT NULL REFERENCES users(id),
    idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
    request_hash    text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    batch_id        uuid NOT NULL REFERENCES listing_batches(id),
    product_ids     uuid[] NOT NULL CHECK (cardinality(product_ids) BETWEEN 1 AND 20),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, idempotency_key)
);


-- ----------------------------------------------------------------------------
-- 5. 协助整理发布：一次性邀请（只存哈希）与审计事件
-- ----------------------------------------------------------------------------

CREATE TABLE listing_assist_invites (
    id                uuid PRIMARY KEY,
    owner_user_id     uuid NOT NULL REFERENCES users(id),
    -- 授权范围二选一：某个草稿，或某个批次里的草稿
    draft_id          uuid,
    batch_id          uuid,
    -- 原始邀请码只在创建时返回一次；这里只保存它的 SHA-256
    token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
    assistant_user_id uuid REFERENCES users(id),
    expires_at        timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    redeemed_at       timestamptz,
    revoked_at        timestamptz,
    FOREIGN KEY (draft_id, owner_user_id) REFERENCES listing_drafts(id, owner_user_id),
    FOREIGN KEY (batch_id, owner_user_id) REFERENCES listing_batches(id, owner_user_id),
    CHECK ((draft_id IS NULL) <> (batch_id IS NULL)),
    -- 有效期：晚于创建时间，且不超过 7 天
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
    CHECK (assistant_user_id IS NULL OR assistant_user_id <> owner_user_id),
    -- 已兑换 ⇔ 有协助人与兑换时间；待兑换时没有协助人
    CHECK ((redeemed_at IS NOT NULL) = (assistant_user_id IS NOT NULL)),
    CHECK (status <> 'PENDING' OR assistant_user_id IS NULL),
    CHECK (status <> 'ACTIVE' OR assistant_user_id IS NOT NULL),
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);

CREATE INDEX listing_assist_invites_owner ON listing_assist_invites(owner_user_id, created_at DESC);
CREATE INDEX listing_assist_invites_assistant ON listing_assist_invites(assistant_user_id) WHERE status = 'ACTIVE';

CREATE TABLE listing_assist_events (
    seq           bigserial PRIMARY KEY,
    invite_id     uuid NOT NULL REFERENCES listing_assist_invites(id),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    -- 只记机器码与关联对象，不记邀请码、草稿内容或商品描述
    event_code    text NOT NULL CHECK (event_code IN ('INVITE_CREATED', 'INVITE_REDEEMED', 'INVITE_REVOKED',
                                                      'ASSIST_DRAFT_EDITED', 'PUBLISHED_AFTER_ASSIST')),
    draft_id      uuid REFERENCES listing_drafts(id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listing_assist_events_invite ON listing_assist_events(invite_id, seq);


-- ----------------------------------------------------------------------------
-- 6. 订单成交价快照
--
-- orders.price 虽然在下单时从商品复制，但数据库层没有不可变保证，且 Flyway 接管之前的旧行
-- 无法证实来源。价格参考因此只使用这里的快照：下单时写入，之后不可修改，也不能为旧订单补写。
-- ----------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN price_snapshot numeric(12,2) CHECK (price_snapshot IS NULL OR price_snapshot >= 0);
ALTER TABLE orders ADD COLUMN currency text CHECK (currency IS NULL OR currency = 'CNY');
ALTER TABLE orders ADD CONSTRAINT orders_price_snapshot_currency CHECK ((price_snapshot IS NULL) = (currency IS NULL));

CREATE FUNCTION orders_price_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot OR NEW.currency IS DISTINCT FROM OLD.currency THEN
        RAISE EXCEPTION '成交价快照只在下单时写入，之后不可修改或补写' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_price_snapshot_guard BEFORE UPDATE OF price_snapshot, currency ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_price_snapshot_guard();

-- 价格参考聚合（SupplyMapper.selectPriceGuidance）的两个部分索引。
-- 计划证据（SupplyPerformanceIT）：21 所学校、约 21 万笔已完成订单时，没有这两个索引是
-- 订单全表顺序扫描 + 哈希连接；有了之后变为「本校校区 → 本校同分类单件商品 → 仅索引扫描取快照」。
CREATE INDEX orders_completed_price_snapshot ON orders(product_id) INCLUDE (price_snapshot, updated_at)
    WHERE status = 'COMPLETED' AND price_snapshot IS NOT NULL;
CREATE INDEX products_single_campus_category ON products(campus, category) WHERE listing_kind = 'SINGLE';
