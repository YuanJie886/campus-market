-- =============================================================================
-- V1 · 校园集市初始数据库结构
--
-- 本脚本是项目数据库结构的唯一基线，内容与 Flyway 接管前的
-- src/main/resources/db/schema.sql 完全等价（14 张业务表、全部约束与索引、
-- 1 所学校 / 4 个校区 / 12 个面交点预置数据）。
--
-- 与旧 schema.sql 的唯一差异是失败策略，不是结构：
--   * 移除 CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   * 移除 INSERT ... ON CONFLICT DO NOTHING
-- V1 只应在空库上执行。若目标库已有残缺结构，此脚本必须立即失败，
-- 而不是像旧的幂等写法那样静默跳过、掩盖结构漂移。
--
-- 所有 UNIQUE / CHECK / 外键均刻意不显式命名，以便 PostgreSQL 生成与旧库
-- 完全相同的自动约束名（如 favorites_user_id_product_id_key、
-- products_status_check），保证旧库基线接管后结构可比对。
--
-- 本文件一旦被任何环境执行过，就禁止再修改：后续结构变更一律新增 V2、V3。
-- 详见 campus-market-backend/docs/database-migrations.md
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 参考数据表：学校 / 校区 / 校内公共面交点
-- ----------------------------------------------------------------------------

CREATE TABLE schools (
    id   text PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE campuses (
    id        text PRIMARY KEY,
    school_id text NOT NULL REFERENCES schools,
    name      text NOT NULL
);

CREATE TABLE meeting_points (
    id        text PRIMARY KEY,
    campus_id text NOT NULL REFERENCES campuses,
    name      text NOT NULL
);


-- ----------------------------------------------------------------------------
-- 用户与会话
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    id            uuid PRIMARY KEY,
    account       text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    nickname      text NOT NULL,
    avatar        text NOT NULL DEFAULT '',
    campus        text NOT NULL REFERENCES campuses(id),
    contact       text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users,
    refresh_hash text NOT NULL,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);


-- ----------------------------------------------------------------------------
-- 商品与收藏
-- ----------------------------------------------------------------------------

CREATE TABLE products (
    id             uuid PRIMARY KEY,
    seller_id      uuid NOT NULL REFERENCES users,
    title          text NOT NULL,
    description    text NOT NULL,
    price          numeric(12,2) NOT NULL CHECK(price>=0),
    category       text NOT NULL,
    condition      text NOT NULL,
    campus         text NOT NULL REFERENCES campuses(id),
    images         jsonb NOT NULL DEFAULT '[]',
    contact        text NOT NULL DEFAULT '',
    original_price numeric(12,2),
    status         text NOT NULL DEFAULT '在售' CHECK(status IN ('在售','已售出','已下架','预约中')),
    views          integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    sold_at        timestamptz
);

CREATE INDEX products_campus_created ON products(campus, created_at DESC);
CREATE INDEX products_seller ON products(seller_id);

CREATE TABLE favorites (
    id         uuid PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users,
    product_id uuid NOT NULL REFERENCES products,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id,product_id)
);


-- ----------------------------------------------------------------------------
-- 订单、状态流水与评价
-- ----------------------------------------------------------------------------

CREATE TABLE orders (
    id                uuid PRIMARY KEY,
    product_id        uuid NOT NULL REFERENCES products,
    buyer_id          uuid NOT NULL REFERENCES users,
    seller_id         uuid NOT NULL REFERENCES users,
    price             numeric(12,2) NOT NULL CHECK(price>=0),
    status            text NOT NULL CHECK(status IN ('PENDING_SELLER_CONFIRM','PENDING_MEETING','BUYER_CONFIRMED','SELLER_CONFIRMED','COMPLETED','CANCELLED','EXPIRED','DISPUTED')),
    meeting_point_id  text NOT NULL REFERENCES meeting_points,
    meeting_at        timestamptz NOT NULL,
    contact           text NOT NULL,
    confirmation_code text NOT NULL,
    code_attempts     integer NOT NULL DEFAULT 0,
    idempotency_key   text NOT NULL,
    request_hash      text NOT NULL,
    expires_at        timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK(buyer_id<>seller_id),
    UNIQUE(buyer_id,idempotency_key)
);

-- 同一商品同时只允许存在一个活跃订单；三个终态不占用名额。
-- 谓词必须与业务状态机保持一致，改动前先阅读 OrderService。
CREATE UNIQUE INDEX one_active_order_per_product ON orders(product_id) WHERE status NOT IN ('CANCELLED','EXPIRED','COMPLETED');
CREATE INDEX orders_buyer ON orders(buyer_id);
CREATE INDEX orders_seller ON orders(seller_id);

CREATE TABLE order_events (
    id          uuid PRIMARY KEY,
    order_id    uuid NOT NULL REFERENCES orders,
    actor_id    uuid REFERENCES users,
    from_status text,
    to_status   text NOT NULL,
    reason      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
    id          uuid PRIMARY KEY,
    order_id    uuid NOT NULL REFERENCES orders,
    reviewer_id uuid NOT NULL REFERENCES users,
    rating      integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment     text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(order_id,reviewer_id)
);


-- ----------------------------------------------------------------------------
-- 公开留言与站内私信
-- ----------------------------------------------------------------------------

CREATE TABLE comments (
    id         uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES products,
    user_id    uuid NOT NULL REFERENCES users,
    content    text NOT NULL,
    parent_id  uuid REFERENCES comments,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
    id         uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES products,
    buyer_id   uuid NOT NULL REFERENCES users,
    seller_id  uuid NOT NULL REFERENCES users,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(product_id,buyer_id),
    CHECK(buyer_id<>seller_id)
);

CREATE TABLE messages (
    id              uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations,
    sender_id       uuid NOT NULL REFERENCES users,
    content         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_created ON messages(conversation_id,created_at);

CREATE TABLE conversation_reads (
    conversation_id uuid NOT NULL REFERENCES conversations,
    user_id         uuid NOT NULL REFERENCES users,
    read_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(conversation_id,user_id)
);


-- ----------------------------------------------------------------------------
-- 预置参考数据：1 所学校、4 个校区、每校区 3 个面交点（共 12 个）
--
-- meeting_points 由 campuses 派生，插入顺序不可调整。
-- 与旧 schema.sql 相比去掉了 ON CONFLICT DO NOTHING：V1 只在空库执行，
-- 若出现主键冲突说明目标库并非空库，应立即失败。
-- ----------------------------------------------------------------------------

INSERT INTO schools(id,name)
VALUES ('pilot','试点学校（请部署时配置）');

INSERT INTO campuses(id,school_id,name)
VALUES ('东校区','pilot','东校区'),
       ('西校区','pilot','西校区'),
       ('南校区','pilot','南校区'),
       ('北校区','pilot','北校区');

INSERT INTO meeting_points(id,campus_id,name)
SELECT id||'-library', id, '图书馆门口' FROM campuses;

INSERT INTO meeting_points(id,campus_id,name)
SELECT id||'-canteen', id, '食堂入口' FROM campuses;

INSERT INTO meeting_points(id,campus_id,name)
SELECT id||'-express', id, '快递站' FROM campuses;
