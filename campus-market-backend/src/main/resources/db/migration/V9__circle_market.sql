-- =============================================================================
-- V9 · 模块 6：圈子集市
--
-- 圈子（班级 / 社团 / 兴趣 / 其他）是用户创建的关系圈，补的是「关系密度」，不替代全校公开市场：
--   * 商品可以是 PUBLIC（全校可见，行为与之前完全相同）或 CIRCLE_ONLY（仅所选圈子的在籍成员可见）；
--   * 可见性只有一个权威实现：SQL 函数 product_visible_to / product_readable_by，所有读取入口共用；
--   * 圈子严格属于一个学校；没有「官方认证」字段——任何用户创建的圈子都不是学校官方的；
--   * 宿舍楼已由楼栋集市覆盖，这里不自动创建任何宿舍圈，也不替任何人加入任何圈子。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V10。
-- =============================================================================


-- 圈子、成员关系与审计事件都不做物理删除：退出、移除、归档都是状态变化，历史保留
CREATE FUNCTION circles_guard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '圈子相关记录保留审计，不能删除或改写' USING ERRCODE = 'check_violation';
END $$;


-- ----------------------------------------------------------------------------
-- 1. circles
-- ----------------------------------------------------------------------------

CREATE TABLE circles (
    id            uuid PRIMARY KEY,
    school_id     text NOT NULL REFERENCES schools(id),
    type          text NOT NULL CHECK (type IN ('CLASS', 'CLUB', 'INTEREST', 'OTHER')),
    name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 30 AND name !~ '[<>]'),
    description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 200 AND description !~ '[<>]'),
    -- PRIVATE：对非成员连名称都不暴露；DISCOVERABLE：只展示名称、简介与「用户创建」标识
    visibility    text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'DISCOVERABLE')),
    -- 与唯一的在籍 OWNER 成员保持一致（提交时由 circle_owner_check 校验）
    owner_user_id uuid NOT NULL REFERENCES users(id),
    status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    archived_at   timestamptz,
    CHECK (updated_at >= created_at),
    CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
    UNIQUE (id, school_id)
);
CREATE INDEX circles_discoverable ON circles(school_id, created_at DESC, id)
    WHERE status = 'ACTIVE' AND visibility = 'DISCOVERABLE';

-- 归档不可撤销；学校与创建时间不可改
CREATE FUNCTION circles_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.school_id <> OLD.school_id OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION '圈子的学校与创建时间不能修改' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'ARCHIVED' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION '圈子已归档，不能再修改' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER circles_guard BEFORE UPDATE ON circles FOR EACH ROW EXECUTE FUNCTION circles_guard();
CREATE TRIGGER circles_no_delete BEFORE DELETE ON circles FOR EACH ROW EXECUTE FUNCTION circles_guard_delete();


-- ----------------------------------------------------------------------------
-- 2. circle_memberships
-- ----------------------------------------------------------------------------

CREATE TABLE circle_memberships (
    circle_id  uuid NOT NULL,
    user_id    uuid NOT NULL REFERENCES users(id),
    school_id  text NOT NULL,
    role       text NOT NULL CHECK (role IN ('OWNER', 'MODERATOR', 'MEMBER')),
    status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT', 'REMOVED')),
    joined_at  timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz,
    PRIMARY KEY (circle_id, user_id),
    FOREIGN KEY (circle_id, school_id) REFERENCES circles(id, school_id),
    CHECK ((status = 'ACTIVE') = (ended_at IS NULL)),
    -- 离开或被移除的记录只保留为普通成员身份，不会残留管理权限
    CHECK (status = 'ACTIVE' OR role = 'MEMBER'),
    CHECK (updated_at >= joined_at)
);
-- 每个圈子至多一个在籍 OWNER（至少一个由提交时的约束触发器保证）
CREATE UNIQUE INDEX circle_memberships_one_owner ON circle_memberships(circle_id)
    WHERE role = 'OWNER' AND status = 'ACTIVE';
-- 「我的圈子」与可见性判断：按用户取在籍成员身份
CREATE INDEX circle_memberships_user_active ON circle_memberships(user_id, circle_id) WHERE status = 'ACTIVE';

-- 成员必须与圈子同校（按成员当前校区所属学校）；成为在籍成员时校验
CREATE FUNCTION circle_memberships_school_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    user_school text;
BEGIN
    IF NEW.status = 'ACTIVE' THEN
        SELECT c.school_id INTO user_school FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = NEW.user_id;
        IF user_school IS DISTINCT FROM NEW.school_id THEN
            RAISE EXCEPTION '只能加入本校的圈子' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.circle_id <> OLD.circle_id OR NEW.user_id <> OLD.user_id OR NEW.school_id <> OLD.school_id) THEN
        RAISE EXCEPTION '成员关系的圈子、用户与学校不能修改' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER circle_memberships_school_guard BEFORE INSERT OR UPDATE ON circle_memberships
    FOR EACH ROW EXECUTE FUNCTION circle_memberships_school_guard();
CREATE TRIGGER circle_memberships_no_delete BEFORE DELETE ON circle_memberships
    FOR EACH ROW EXECUTE FUNCTION circles_guard_delete();

-- 提交时检查：在用的圈子恰好有一个在籍 OWNER，且与 circles.owner_user_id 一致
CREATE FUNCTION circle_owner_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    cid uuid;
    circle_status text;
    circle_owner uuid;
    owners integer;
    active_owner uuid;
BEGIN
    IF TG_TABLE_NAME = 'circles' THEN
        cid := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        cid := OLD.circle_id;
    ELSE
        cid := NEW.circle_id;
    END IF;
    SELECT status, owner_user_id INTO circle_status, circle_owner FROM circles WHERE id = cid;
    IF circle_status = 'ACTIVE' THEN
        SELECT count(*), min(user_id::text)::uuid INTO owners, active_owner
        FROM circle_memberships WHERE circle_id = cid AND role = 'OWNER' AND status = 'ACTIVE';
        IF owners <> 1 OR active_owner <> circle_owner THEN
            RAISE EXCEPTION '在用的圈子必须恰好有一个在籍所有者' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER circle_owner_on_memberships AFTER INSERT OR UPDATE ON circle_memberships
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION circle_owner_check();
CREATE CONSTRAINT TRIGGER circle_owner_on_circles AFTER INSERT OR UPDATE ON circles
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION circle_owner_check();


-- ----------------------------------------------------------------------------
-- 3. 审计事件与邀请
-- ----------------------------------------------------------------------------

CREATE TABLE circle_events (
    seq            bigserial PRIMARY KEY,
    circle_id      uuid NOT NULL REFERENCES circles(id),
    actor_user_id  uuid NOT NULL REFERENCES users(id),
    target_user_id uuid REFERENCES users(id),
    event_code     text NOT NULL CHECK (event_code IN (
        'CIRCLE_CREATED', 'CIRCLE_UPDATED', 'CIRCLE_ARCHIVED', 'INVITE_CREATED', 'INVITE_REVOKED',
        'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'ROLE_CHANGED', 'OWNER_TRANSFERRED')),
    -- 只放机器码（例如新角色），不放邀请码、姓名或任何自由文本
    detail_code    text CHECK (detail_code IS NULL OR detail_code IN ('OWNER', 'MODERATOR', 'MEMBER')),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX circle_events_circle ON circle_events(circle_id, seq);
CREATE TRIGGER circle_events_no_delete BEFORE UPDATE OR DELETE ON circle_events
    FOR EACH ROW EXECUTE FUNCTION circles_guard_delete();

CREATE TABLE circle_invites (
    id          uuid PRIMARY KEY,
    circle_id   uuid NOT NULL REFERENCES circles(id),
    created_by  uuid NOT NULL REFERENCES users(id),
    -- 只存随机邀请码的 SHA-256；原始邀请码只在创建响应里出现一次
    token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REDEEMED', 'REVOKED')),
    redeemed_by uuid REFERENCES users(id),
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    redeemed_at timestamptz,
    revoked_at  timestamptz,
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
    CHECK ((status = 'REDEEMED') = (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)),
    CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
);
CREATE INDEX circle_invites_circle ON circle_invites(circle_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- 4. 商品可见性
-- ----------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN visibility text NOT NULL DEFAULT 'PUBLIC'
    CHECK (visibility IN ('PUBLIC', 'CIRCLE_ONLY'));

CREATE TABLE product_circle_visibility (
    product_id uuid NOT NULL REFERENCES products(id),
    circle_id  uuid NOT NULL REFERENCES circles(id),
    -- 写入这一行的时刻（不是事务开始时刻），用于与归档、退出的生效顺序比较
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (product_id, circle_id)
);
-- 圈子商品流：按圈子取商品
CREATE INDEX product_circle_visibility_circle ON product_circle_visibility(circle_id, product_id);

-- 写入限制行时：商品必须是 CIRCLE_ONLY；圈子在用且与商品同校；卖家是该圈在籍成员
CREATE FUNCTION product_circle_visibility_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    p_visibility text;
    p_seller uuid;
    p_school text;
    c_school text;
    c_status text;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION '圈子可见关系不能修改，只能删除后重新写入' USING ERRCODE = 'check_violation';
    END IF;
    SELECT p.visibility, p.seller_id, cp.school_id INTO p_visibility, p_seller, p_school
    FROM products p JOIN campuses cp ON cp.id = p.campus WHERE p.id = NEW.product_id;
    SELECT school_id, status INTO c_school, c_status FROM circles WHERE id = NEW.circle_id;
    IF p_visibility <> 'CIRCLE_ONLY' THEN
        RAISE EXCEPTION '只有圈子可见的商品可以关联圈子' USING ERRCODE = 'check_violation';
    END IF;
    IF c_status <> 'ACTIVE' OR c_school IS DISTINCT FROM p_school THEN
        RAISE EXCEPTION '只能发布到本校在用的圈子' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM circle_memberships m
                   WHERE m.circle_id = NEW.circle_id AND m.user_id = p_seller AND m.status = 'ACTIVE') THEN
        RAISE EXCEPTION '只有圈子的在籍成员可以发布到这个圈子' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER product_circle_visibility_guard BEFORE INSERT OR UPDATE ON product_circle_visibility
    FOR EACH ROW EXECUTE FUNCTION product_circle_visibility_guard();

-- 提交时检查：PUBLIC 商品没有限制行；CIRCLE_ONLY 商品关联 1～5 个圈子
CREATE FUNCTION product_visibility_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pid uuid;
    v text;
    n integer;
BEGIN
    IF TG_TABLE_NAME = 'products' THEN
        pid := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        pid := OLD.product_id;
    ELSE
        pid := NEW.product_id;
    END IF;
    SELECT visibility INTO v FROM products WHERE id = pid;
    SELECT count(*) INTO n FROM product_circle_visibility WHERE product_id = pid;
    IF v = 'PUBLIC' AND n <> 0 THEN
        RAISE EXCEPTION '全校公开的商品不能关联圈子' USING ERRCODE = 'check_violation';
    END IF;
    IF v = 'CIRCLE_ONLY' AND (n < 1 OR n > 5) THEN
        RAISE EXCEPTION '圈子可见的商品需要关联 1～5 个圈子（当前 % 个）', n USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_visibility_on_links AFTER INSERT OR DELETE ON product_circle_visibility
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_visibility_check();
CREATE CONSTRAINT TRIGGER product_visibility_on_products AFTER INSERT OR UPDATE OF visibility ON products
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_visibility_check();


-- 首页 / 搜索列表按「最新」排序（ORDER BY created_at DESC, id）。之前没有这条索引，列表是全表顺序扫描 + 排序；
-- 加入可见性判断后，每一行都要先算可见性再排序，登录用户的首页在 5 万件商品时慢了一倍多（CirclePerformanceIT 计划证据）。
-- 有了它，规划器按索引顺序读、边读边判断可见性，凑满一页即停止。
CREATE INDEX products_created_order ON products(created_at DESC, id);


-- ----------------------------------------------------------------------------
-- 5. 权威可见性策略（唯一实现）
--
-- product_visible_to：出现在列表 / 搜索 / feed / 计数 / 收藏列表 / 需求匹配 / 收件箱 / 未读数里的条件。
--   PUBLIC → 所有人（含未登录）；CIRCLE_ONLY → 卖家本人，或至少一个关联圈子（在用）的在籍成员。
-- product_readable_by：单个商品的直接访问（详情、分享链接、收藏 / 评论 / 会话 / 下单的前置检查）。
--   在上面之外，再允许「这件商品上仍有效或已完成订单的参与者」——他们需要完成交易；
--   这个例外只针对这一件商品，不会恢复对卖家其他圈子商品的访问。
--
-- 两个函数都是单个 SELECT 表达式、STABLE，PostgreSQL 会把它们内联进调用处的执行计划。
-- ----------------------------------------------------------------------------

CREATE FUNCTION product_visible_to(p_id uuid, p_visibility text, p_seller uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT p_visibility = 'PUBLIC'
        OR (viewer IS NOT NULL AND (
                p_seller = viewer
             OR EXISTS (SELECT 1
                        FROM product_circle_visibility v
                        JOIN circle_memberships m ON m.circle_id = v.circle_id AND m.user_id = viewer AND m.status = 'ACTIVE'
                        JOIN circles c ON c.id = v.circle_id AND c.status = 'ACTIVE'
                        WHERE v.product_id = p_id)))
$$;

CREATE FUNCTION product_readable_by(p_id uuid, p_visibility text, p_seller uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT product_visible_to(p_id, p_visibility, p_seller, viewer)
        OR (viewer IS NOT NULL AND EXISTS (
                SELECT 1 FROM orders o
                WHERE o.product_id = p_id AND (o.buyer_id = viewer OR o.seller_id = viewer)
                  AND o.status NOT IN ('CANCELLED', 'EXPIRED')))
$$;


-- ----------------------------------------------------------------------------
-- 6. 需求订阅的圈子范围（ALTER 演进，不修改 V4 / V6）
-- ----------------------------------------------------------------------------

ALTER TABLE demand_subscriptions ADD COLUMN circle_id uuid REFERENCES circles(id);
-- 圈子订阅：范围固定为 SCHOOL（圈子本身就是范围），不与教材版本订阅组合
ALTER TABLE demand_subscriptions ADD CONSTRAINT demand_subscriptions_circle_shape
    CHECK (circle_id IS NULL OR (geo_scope = 'SCHOOL' AND textbook_edition_id IS NULL));
-- 圈子订阅的候选：按圈子取在用订阅
CREATE INDEX demand_subscriptions_match_circle ON demand_subscriptions(circle_id, category)
    WHERE active AND circle_id IS NOT NULL;
-- 全校公开商品的普通订阅候选：排除圈子订阅。它是 V6 的 demand_subscriptions_match_plain 的严格子集，
-- 候选查询加上「circle_id IS NULL」后规划器只会选它（计划见 CirclePerformanceIT / TextbookPerformanceIT），
-- 旧索引不再有查询使用，保留只会增加写放大，因此在这里删除（不修改 V6 本身）。
CREATE INDEX demand_subscriptions_match_public ON demand_subscriptions(school_id, category)
    WHERE active AND textbook_edition_id IS NULL AND circle_id IS NULL;
DROP INDEX demand_subscriptions_match_plain;

-- 圈子订阅只能由在籍成员创建或重新启用
CREATE FUNCTION demand_subscriptions_circle_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.circle_id IS NOT NULL AND NEW.active AND NOT EXISTS (
        SELECT 1 FROM circle_memberships m JOIN circles c ON c.id = m.circle_id AND c.status = 'ACTIVE'
        WHERE m.circle_id = NEW.circle_id AND m.user_id = NEW.user_id AND m.status = 'ACTIVE') THEN
        RAISE EXCEPTION '只有圈子的在籍成员可以订阅这个圈子' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.circle_id IS DISTINCT FROM OLD.circle_id THEN
        RAISE EXCEPTION '订阅的圈子不能修改' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER demand_subscriptions_circle_guard BEFORE INSERT OR UPDATE ON demand_subscriptions
    FOR EACH ROW EXECUTE FUNCTION demand_subscriptions_circle_guard();


-- ----------------------------------------------------------------------------
-- 7. 订单的可见性快照；公开价格参考排除圈子商品
-- ----------------------------------------------------------------------------

-- 下单瞬间商品是否仅圈子可见。V9 之前不存在圈子商品，旧订单保持 NULL（等价于公开，但不回填）
ALTER TABLE orders ADD COLUMN visibility_snapshot text
    CHECK (visibility_snapshot IS NULL OR visibility_snapshot IN ('PUBLIC', 'CIRCLE_ONLY'));
CREATE FUNCTION orders_visibility_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.visibility_snapshot IS DISTINCT FROM OLD.visibility_snapshot THEN
        RAISE EXCEPTION '可见性快照只在下单时写入，之后不可修改或补写' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_visibility_snapshot_guard BEFORE UPDATE OF visibility_snapshot ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_visibility_snapshot_guard();

-- 价格参考的覆盖索引加上「不是圈子商品」这一条件（替换 V8 的同名用途索引）
CREATE INDEX orders_public_trade_guidance ON orders(school_id_snapshot, category_snapshot, condition_snapshot)
    INCLUDE (price_snapshot, updated_at, textbook_edition_id_snapshot)
    WHERE status = 'COMPLETED' AND price_snapshot IS NOT NULL AND listing_kind_snapshot = 'SINGLE'
      AND visibility_snapshot IS DISTINCT FROM 'CIRCLE_ONLY';
DROP INDEX orders_trade_guidance;
