-- ============================================================================
-- V10：模块 6.1 收口 + 模块 7 交易承诺、防爽约与可信治理
--
-- 6.1A 学校隔离：「PUBLIC」表示当前学校公开。权威可见性函数加入学校口径与治理隐藏；
--      商品校区必须与卖家同校、订单买家必须与商品同校（触发器兜底）。
-- 6.1C 圈子成员分页索引与 1000 人在籍上限（触发器内锁圈子行后计数）。
-- 7.1  订单取消记录：结构化原因，与取消状态变化同一事务写入，一张订单至多一条，不可改写。
-- 7.2  爽约报告：必须基于双方确认过的档期；单方报告只是 PENDING，不产生任何处罚。
-- 7.3  平台工作人员：表默认为空，不植入任何账号；首个工作人员按运维手册用受控 SQL 配置。
-- 7.4  举报、治理案件、治理动作（只增不改）、申诉。
-- 7.5  用户限制：有期限（最长 30 天）、有来源、可撤销但不可删除。
--
-- 只加结构，不伪造任何数据：没有工作人员、举报、案件、处罚或爽约记录；
-- 旧的已取消订单不补写取消原因。V1～V9 一个字节都不改；这里用 CREATE OR REPLACE 重新定义 V9 的两个函数。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1A 治理隐藏（商品）
-- ----------------------------------------------------------------------------

ALTER TABLE products ADD COLUMN moderation_hidden_at timestamptz;

-- 查看者所在学校。STABLE：同一语句内对同一 viewer 只算一次（在列表里成为 InitPlan）
CREATE FUNCTION viewer_school(viewer uuid) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = viewer
$$;

-- 权威可见性（6 参数版本，列表 / 计数 / feed / 收藏 / 需求匹配 / 收件箱 / 未读数使用）：
--   1. 必须登录，且商品校区属于查看者的学校（他校商品对任何人都不可见，包括 PUBLIC）；
--   2. 被治理隐藏的商品只有卖家本人能看到；
--   3. PUBLIC；或卖家本人；或该商品某个 ACTIVE 圈子的在籍成员（与 V9 相同）。
CREATE FUNCTION product_visible_to(p_id uuid, p_visibility text, p_seller uuid, p_campus text, p_hidden_at timestamptz, viewer uuid)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT viewer IS NOT NULL
       AND p_campus IN (SELECT c.id FROM campuses c WHERE c.school_id = viewer_school(viewer))
       AND (p_hidden_at IS NULL OR p_seller = viewer)
       AND (p_visibility = 'PUBLIC'
            OR p_seller = viewer
            OR EXISTS (SELECT 1
                       FROM product_circle_visibility v
                       JOIN circle_memberships m ON m.circle_id = v.circle_id AND m.user_id = viewer AND m.status = 'ACTIVE'
                       JOIN circles c ON c.id = v.circle_id AND c.status = 'ACTIVE'
                       WHERE v.product_id = p_id))
$$;

-- 单个商品的直接访问：再加上这件商品上未取消、未过期订单的买卖双方（订单参与者例外只针对这一件商品）。
-- 已成立的订单不因治理隐藏或学校变化被锁死。
CREATE FUNCTION product_readable_by(p_id uuid, p_visibility text, p_seller uuid, p_campus text, p_hidden_at timestamptz, viewer uuid)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT product_visible_to(p_id, p_visibility, p_seller, p_campus, p_hidden_at, viewer)
        OR (viewer IS NOT NULL AND EXISTS (
                SELECT 1 FROM orders o
                WHERE o.product_id = p_id AND (o.buyer_id = viewer OR o.seller_id = viewer)
                  AND o.status NOT IN ('CANCELLED', 'EXPIRED')))
$$;

-- V9 的 4 参数版本改为委托给 6 参数版本，任何遗留调用方都得到同一结论
CREATE OR REPLACE FUNCTION product_visible_to(p_id uuid, p_visibility text, p_seller uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT COALESCE((SELECT product_visible_to(p.id, p_visibility, p_seller, p.campus, p.moderation_hidden_at, viewer)
                     FROM products p WHERE p.id = p_id), false)
$$;

CREATE OR REPLACE FUNCTION product_readable_by(p_id uuid, p_visibility text, p_seller uuid, viewer uuid) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT COALESCE((SELECT product_readable_by(p.id, p_visibility, p_seller, p.campus, p.moderation_hidden_at, viewer)
                     FROM products p WHERE p.id = p_id), false)
$$;

-- 商品校区必须与卖家同校（发布、改校区、换卖家都检查）
CREATE FUNCTION products_same_school_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_school text; seller_school text;
BEGIN
    SELECT school_id INTO product_school FROM campuses WHERE id = NEW.campus;
    SELECT viewer_school(NEW.seller_id) INTO seller_school;
    IF product_school IS DISTINCT FROM seller_school THEN
        RAISE EXCEPTION 'product campus must belong to the seller''s school' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER products_same_school_guard
    BEFORE INSERT OR UPDATE OF campus, seller_id ON products
    FOR EACH ROW EXECUTE FUNCTION products_same_school_guard();

-- 订单买家必须与商品同校（只检查新订单；已有订单保持原样）
CREATE FUNCTION orders_same_school_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_school text;
BEGIN
    SELECT c.school_id INTO product_school FROM products p JOIN campuses c ON c.id = p.campus WHERE p.id = NEW.product_id;
    IF product_school IS DISTINCT FROM viewer_school(NEW.buyer_id) THEN
        RAISE EXCEPTION 'buyer must belong to the product''s school' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER orders_same_school_guard
    BEFORE INSERT ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_same_school_guard();

-- ----------------------------------------------------------------------------
-- 6.1C 圈子成员：稳定分页（角色优先级 → 加入时间 → userId）与 1000 人在籍上限
-- ----------------------------------------------------------------------------

CREATE FUNCTION circle_role_rank(role text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE role WHEN 'OWNER' THEN 0 WHEN 'MODERATOR' THEN 1 ELSE 2 END
$$;

-- INCLUDE (role)：分页子查询可以只读索引取出一页，再按主键连接 users（深页也不对全部成员排序）
CREATE INDEX circle_memberships_page
    ON circle_memberships (circle_id, circle_role_rank(role), joined_at, user_id) INCLUDE (role)
    WHERE status = 'ACTIVE';

-- 成为在籍成员（新加入或 LEFT / REMOVED 后重新加入）时：先锁圈子行，再数在籍人数。
-- 并发兑换在圈子行锁上串行化，因此不会超过上限；已在籍的成员不经过这里（不重复占名额）。
CREATE FUNCTION circle_member_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_count integer;
BEGIN
    IF NEW.status = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD.status <> 'ACTIVE') THEN
        PERFORM 1 FROM circles WHERE id = NEW.circle_id FOR UPDATE;
        SELECT count(*) INTO active_count FROM circle_memberships WHERE circle_id = NEW.circle_id AND status = 'ACTIVE';
        IF active_count >= 1000 THEN
            RAISE EXCEPTION 'circle member limit reached' USING ERRCODE = 'check_violation', HINT = 'circle_member_limit';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER circle_member_cap_guard
    BEFORE INSERT OR UPDATE OF status ON circle_memberships
    FOR EACH ROW EXECUTE FUNCTION circle_member_cap_guard();

-- ----------------------------------------------------------------------------
-- 通用：只增不改 / 不可删除
-- ----------------------------------------------------------------------------

CREATE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

-- ----------------------------------------------------------------------------
-- 7.1 订单取消记录
-- ----------------------------------------------------------------------------

CREATE TABLE order_cancellations (
    order_id      uuid PRIMARY KEY REFERENCES orders(id),
    school_id     text NOT NULL REFERENCES schools(id),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    phase         text NOT NULL CHECK (phase IN ('BEFORE_SELLER_CONFIRM','AFTER_SELLER_CONFIRM','AFTER_MEETING_AGREED',
                                                 'AFTER_ARRIVAL_REPORTED','INSPECTION_MISMATCH')),
    reason_code   text CHECK (reason_code IN ('CHANGED_MIND','SCHEDULE_CONFLICT','ITEM_UNAVAILABLE','CONDITION_MISMATCH',
                                              'COUNTERPART_UNRESPONSIVE','OTHER')),
    note          text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 200 AND note !~ '[<>]')),
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- 卖家确认之后的取消必须选择结构化原因；「其他」必须写一句说明
    CHECK (reason_code IS NOT NULL OR phase = 'BEFORE_SELLER_CONFIRM'),
    CHECK (reason_code IS DISTINCT FROM 'OTHER' OR note IS NOT NULL)
);

CREATE INDEX order_cancellations_actor ON order_cancellations (actor_user_id, created_at DESC);
CREATE INDEX order_cancellations_school ON order_cancellations (school_id, created_at DESC);

-- 取消记录只能跟随取消状态变化写入（订单此刻必须已是 CANCELLED）、执行人必须是订单一方
CREATE FUNCTION order_cancellations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
    SELECT status, buyer_id, seller_id INTO o FROM orders WHERE id = NEW.order_id;
    IF o.status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'cancellation record requires a cancelled order' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.actor_user_id <> o.buyer_id AND NEW.actor_user_id <> o.seller_id THEN
        RAISE EXCEPTION 'only order participants may cancel' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_cancellations_guard BEFORE INSERT ON order_cancellations
    FOR EACH ROW EXECUTE FUNCTION order_cancellations_guard();
CREATE TRIGGER order_cancellations_append_only BEFORE UPDATE OR DELETE ON order_cancellations
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ----------------------------------------------------------------------------
-- 7.3 平台工作人员（默认为空）
-- ----------------------------------------------------------------------------

CREATE TABLE staff_members (
    user_id    uuid PRIMARY KEY REFERENCES users(id),
    school_id  text NOT NULL REFERENCES schools(id),
    role       text NOT NULL CHECK (role IN ('MODERATOR','SENIOR_MODERATOR')),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- 工作人员只能属于本人所在学校；账号不能在表里被「搬」到另一个人
CREATE FUNCTION staff_members_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'staff records cannot be deleted; set active = false' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at) THEN
        RAISE EXCEPTION 'staff identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.school_id IS DISTINCT FROM viewer_school(NEW.user_id) THEN
        RAISE EXCEPTION 'staff school must match the user''s school' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER staff_members_guard BEFORE INSERT OR UPDATE OR DELETE ON staff_members
    FOR EACH ROW EXECUTE FUNCTION staff_members_guard();

-- ----------------------------------------------------------------------------
-- 7.4 治理案件 / 举报 / 动作 / 申诉
-- ----------------------------------------------------------------------------

CREATE TABLE moderation_cases (
    id                uuid PRIMARY KEY,
    school_id         text NOT NULL REFERENCES schools(id),
    target_type       text NOT NULL CHECK (target_type IN ('PRODUCT','USER','CIRCLE','COMMENT','MESSAGE','ORDER','NO_SHOW')),
    target_id         uuid NOT NULL,
    status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED','APPEALED')),
    assigned_staff_id uuid REFERENCES users(id),
    resolution_code   text CHECK (resolution_code IN ('HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING',
                                                      'RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION','CONFIRM_NO_SHOW',
                                                      'REJECT_NO_SHOW','NO_ACTION')),
    report_count      integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
    created_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    resolved_at       timestamptz,
    CHECK ((status IN ('RESOLVED','DISMISSED')) = (resolution_code IS NOT NULL AND resolved_at IS NOT NULL)
           OR status = 'APPEALED'),
    CHECK (updated_at >= created_at)
);

-- 同一目标同时只有一个未结案件；后续举报并入它
CREATE UNIQUE INDEX moderation_cases_one_open ON moderation_cases (school_id, target_type, target_id)
    WHERE status IN ('OPEN','UNDER_REVIEW','APPEALED');
-- 工作人员待处理列表：学校在索引前缀，按创建时间分页
CREATE INDEX moderation_cases_queue ON moderation_cases (school_id, status, created_at, id);
CREATE INDEX moderation_cases_target ON moderation_cases (school_id, target_type, target_id, created_at DESC);

-- 已结案件不能改回待处理；结果一旦写入就不能换（申诉走独立记录）
CREATE FUNCTION moderation_cases_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'moderation cases cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.school_id <> OLD.school_id OR NEW.target_type <> OLD.target_type OR NEW.target_id <> OLD.target_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'case identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.resolution_code IS NOT NULL AND NEW.resolution_code IS DISTINCT FROM OLD.resolution_code THEN
        RAISE EXCEPTION 'case resolution is final' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('RESOLVED','DISMISSED') AND NEW.status IN ('OPEN','UNDER_REVIEW') THEN
        RAISE EXCEPTION 'resolved cases cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER moderation_cases_guard BEFORE UPDATE OR DELETE ON moderation_cases
    FOR EACH ROW EXECUTE FUNCTION moderation_cases_guard();

CREATE TABLE moderation_reports (
    id               uuid PRIMARY KEY,
    school_id        text NOT NULL REFERENCES schools(id),
    case_id          uuid NOT NULL REFERENCES moderation_cases(id),
    reporter_user_id uuid NOT NULL REFERENCES users(id),
    target_type      text NOT NULL CHECK (target_type IN ('PRODUCT','USER','CIRCLE','COMMENT','MESSAGE','ORDER','NO_SHOW')),
    target_id        uuid NOT NULL,
    reason_code      text NOT NULL CHECK (reason_code IN ('PROHIBITED_ITEM','MISLEADING','FRAUD_SUSPECTED','HARASSMENT',
                                                          'SPAM','IMPERSONATION','NO_SHOW_REVIEW','OTHER')),
    note             text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 500 AND note !~ '[<>]')),
    -- 必要快照：被举报的那一条内容本身（例如一条消息的正文），不复制整段会话
    snapshot         text CHECK (snapshot IS NULL OR char_length(snapshot) <= 2000),
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (reason_code IS DISTINCT FROM 'OTHER' OR note IS NOT NULL)
);

-- 同一人对同一目标只保留一份举报（重复提交幂等返回原举报）
CREATE UNIQUE INDEX moderation_reports_once ON moderation_reports (reporter_user_id, target_type, target_id);
CREATE INDEX moderation_reports_mine ON moderation_reports (reporter_user_id, created_at DESC);
CREATE INDEX moderation_reports_case ON moderation_reports (case_id, created_at);

CREATE TRIGGER moderation_reports_append_only BEFORE UPDATE OR DELETE ON moderation_reports
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ----------------------------------------------------------------------------
-- 7.5 用户限制
-- ----------------------------------------------------------------------------

CREATE TABLE user_restrictions (
    id                 uuid PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES users(id),
    school_id          text NOT NULL REFERENCES schools(id),
    scope              text NOT NULL CHECK (scope IN ('BOOKING','PUBLISHING','CIRCLE_CREATION')),
    source             text NOT NULL CHECK (source IN ('CASE','NO_SHOW_RULE')),
    case_id            uuid REFERENCES moderation_cases(id),
    no_show_report_id  uuid,
    created_by         uuid REFERENCES users(id),
    reason_code        text NOT NULL,
    starts_at          timestamptz NOT NULL,
    ends_at            timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at         timestamptz,
    revoked_by         uuid REFERENCES users(id),
    revoke_reason      text CHECK (revoke_reason IS NULL OR revoke_reason IN ('APPEAL_ACCEPTED','STAFF_CORRECTION')),
    -- 第一阶段不允许永久限制：最长 30 天
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '30 days'),
    -- 来源：工作人员在某个案件里做出的决定；或确认爽约后按公开规则自动生成（记录对应的爽约报告）
    CHECK ((source = 'CASE' AND case_id IS NOT NULL AND created_by IS NOT NULL)
           OR (source = 'NO_SHOW_RULE' AND no_show_report_id IS NOT NULL)),
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

-- 当前有效限制：按用户 + 范围 + 到期时间
CREATE INDEX user_restrictions_active ON user_restrictions (user_id, scope, ends_at) WHERE revoked_at IS NULL;
CREATE INDEX user_restrictions_school ON user_restrictions (school_id, created_at DESC);
-- 「我的限制」：本人的全部限制（含已撤销 / 已到期），按时间倒序
CREATE INDEX user_restrictions_mine ON user_restrictions (user_id, created_at DESC);
-- 一份爽约报告至多触发一次自动限制
CREATE UNIQUE INDEX user_restrictions_one_per_no_show ON user_restrictions (no_show_report_id) WHERE no_show_report_id IS NOT NULL;

-- 限制不可删除；只能撤销一次（写入撤销时间、撤销人与原因），其余字段不可改
CREATE FUNCTION user_restrictions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'restrictions cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'revoked restrictions are immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.user_id, NEW.school_id, NEW.scope, NEW.source, NEW.case_id, NEW.no_show_report_id, NEW.created_by,
        NEW.reason_code, NEW.starts_at, NEW.ends_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.user_id, OLD.school_id, OLD.scope, OLD.source, OLD.case_id, OLD.no_show_report_id, OLD.created_by,
        OLD.reason_code, OLD.starts_at, OLD.ends_at, OLD.created_at) THEN
        RAISE EXCEPTION 'only revocation fields may change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER user_restrictions_guard BEFORE UPDATE OR DELETE ON user_restrictions
    FOR EACH ROW EXECUTE FUNCTION user_restrictions_guard();

-- ----------------------------------------------------------------------------
-- 7.2 爽约报告
-- ----------------------------------------------------------------------------

CREATE TABLE order_no_show_reports (
    id               uuid PRIMARY KEY,
    order_id         uuid NOT NULL REFERENCES orders(id),
    meeting_revision integer NOT NULL CHECK (meeting_revision >= 0),
    school_id        text NOT NULL REFERENCES schools(id),
    reporter_user_id uuid NOT NULL REFERENCES users(id),
    reported_user_id uuid NOT NULL REFERENCES users(id),
    status           text NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','ACKNOWLEDGED','DISPUTED','CONFIRMED','REJECTED','EXPIRED')),
    reason_code      text NOT NULL CHECK (reason_code IN ('DID_NOT_ARRIVE','ARRIVED_TOO_LATE','UNREACHABLE_AT_MEETING','OTHER')),
    note             text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 200 AND note !~ '[<>]')),
    response_note    text CHECK (response_note IS NULL OR (char_length(response_note) BETWEEN 1 AND 200 AND response_note !~ '[<>]')),
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    responded_at     timestamptz,
    decided_at       timestamptz,
    decided_by       uuid REFERENCES users(id),
    -- 已确认（对方承认或工作人员确认）的时间：30 天滚动窗口按它计数
    confirmed_at     timestamptz,
    CHECK (reporter_user_id <> reported_user_id),
    CHECK (reason_code IS DISTINCT FROM 'OTHER' OR note IS NOT NULL),
    CHECK ((status IN ('ACKNOWLEDGED','CONFIRMED')) = (confirmed_at IS NOT NULL)),
    CHECK (status <> 'CONFIRMED' OR decided_by IS NOT NULL),
    CHECK (status NOT IN ('ACKNOWLEDGED','DISPUTED') OR responded_at IS NOT NULL)
);

-- 同一订单、同一档期版本、同一被报告人最多一条有效报告
CREATE UNIQUE INDEX order_no_show_reports_one_active ON order_no_show_reports (order_id, meeting_revision, reported_user_id)
    WHERE status IN ('PENDING','ACKNOWLEDGED','DISPUTED','CONFIRMED');
-- 30 天窗口内的已确认爽约次数
CREATE INDEX order_no_show_reports_confirmed ON order_no_show_reports (reported_user_id, confirmed_at)
    WHERE status IN ('ACKNOWLEDGED','CONFIRMED');
CREATE INDEX order_no_show_reports_order ON order_no_show_reports (order_id, created_at);
CREATE INDEX order_no_show_reports_involved ON order_no_show_reports (reported_user_id, created_at DESC);
CREATE INDEX order_no_show_reports_reporter ON order_no_show_reports (reporter_user_id, created_at DESC);

ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_no_show_fk
    FOREIGN KEY (no_show_report_id) REFERENCES order_no_show_reports(id);

-- 报告双方必须是订单的买卖双方；已结束的状态不能回到待处理；身份与档期版本不可改
CREATE FUNCTION order_no_show_reports_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'no-show reports cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT buyer_id, seller_id INTO o FROM orders WHERE id = NEW.order_id;
        IF NOT ((NEW.reporter_user_id = o.buyer_id AND NEW.reported_user_id = o.seller_id)
             OR (NEW.reporter_user_id = o.seller_id AND NEW.reported_user_id = o.buyer_id)) THEN
            RAISE EXCEPTION 'no-show reports are only between order participants' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.status <> 'PENDING' THEN
            RAISE EXCEPTION 'no-show reports start as PENDING' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.order_id, NEW.meeting_revision, NEW.school_id, NEW.reporter_user_id, NEW.reported_user_id, NEW.reason_code,
        NEW.note, NEW.created_at) IS DISTINCT FROM
       (OLD.order_id, OLD.meeting_revision, OLD.school_id, OLD.reporter_user_id, OLD.reported_user_id, OLD.reason_code,
        OLD.note, OLD.created_at) THEN
        RAISE EXCEPTION 'no-show report identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    -- PENDING → ACKNOWLEDGED / DISPUTED / CONFIRMED / REJECTED / EXPIRED；DISPUTED → CONFIRMED / REJECTED / EXPIRED；
    -- 已确认的只能在申诉成功后改为 REJECTED；其余终态不可再变
    IF NOT (OLD.status = NEW.status
            OR (OLD.status = 'PENDING' AND NEW.status IN ('ACKNOWLEDGED','DISPUTED','CONFIRMED','REJECTED','EXPIRED'))
            OR (OLD.status = 'DISPUTED' AND NEW.status IN ('CONFIRMED','REJECTED','EXPIRED'))
            OR (OLD.status IN ('ACKNOWLEDGED','CONFIRMED') AND NEW.status = 'REJECTED')) THEN
        RAISE EXCEPTION 'invalid no-show status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_no_show_reports_guard BEFORE INSERT OR UPDATE OR DELETE ON order_no_show_reports
    FOR EACH ROW EXECUTE FUNCTION order_no_show_reports_guard();

ALTER TABLE moderation_cases ADD COLUMN no_show_report_id uuid REFERENCES order_no_show_reports(id);
CREATE UNIQUE INDEX moderation_cases_no_show ON moderation_cases (no_show_report_id)
    WHERE no_show_report_id IS NOT NULL AND status IN ('OPEN','UNDER_REVIEW','APPEALED');

CREATE TABLE moderation_actions (
    id             uuid PRIMARY KEY,
    school_id      text NOT NULL REFERENCES schools(id),
    case_id        uuid REFERENCES moderation_cases(id),
    appeal_id      uuid,
    staff_user_id  uuid NOT NULL REFERENCES users(id),
    action_code    text NOT NULL CHECK (action_code IN ('HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING',
                                                        'RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION','CONFIRM_NO_SHOW',
                                                        'REJECT_NO_SHOW','NO_ACTION','REVOKE_RESTRICTION','ACCEPT_APPEAL',
                                                        'REJECT_APPEAL')),
    reason_code    text NOT NULL CHECK (reason_code IN ('POLICY_VIOLATION','PROHIBITED_ITEM','HARASSMENT','FRAUD_RISK',
                                                        'CONFIRMED_NO_SHOW','INSUFFICIENT_EVIDENCE','APPEAL_ACCEPTED',
                                                        'APPEAL_REJECTED','DUPLICATE','OTHER')),
    note           text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 500 AND note !~ '[<>]')),
    target_type    text NOT NULL CHECK (target_type IN ('PRODUCT','USER','CIRCLE','COMMENT','MESSAGE','ORDER','NO_SHOW','RESTRICTION','APPEAL')),
    target_id      uuid NOT NULL,
    restriction_id uuid REFERENCES user_restrictions(id),
    expires_at     timestamptz,
    -- 动作是否真的改变了目标（例如对已归档圈子的强制归档记为 false）
    effective      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (action_code NOT LIKE 'RESTRICT_%' OR (restriction_id IS NOT NULL AND expires_at IS NOT NULL) OR effective = false),
    CHECK (case_id IS NOT NULL OR appeal_id IS NOT NULL)
);

CREATE INDEX moderation_actions_case ON moderation_actions (case_id, created_at);
CREATE INDEX moderation_actions_school ON moderation_actions (school_id, created_at DESC);
CREATE INDEX moderation_actions_target ON moderation_actions (school_id, target_type, target_id, created_at DESC);

CREATE TRIGGER moderation_actions_append_only BEFORE UPDATE OR DELETE ON moderation_actions
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- 商品隐藏由哪个动作造成（恢复时同样写一条动作记录）
ALTER TABLE products ADD COLUMN moderation_hidden_action_id uuid REFERENCES moderation_actions(id);

CREATE TABLE moderation_appeals (
    id             uuid PRIMARY KEY,
    school_id      text NOT NULL REFERENCES schools(id),
    user_id        uuid NOT NULL REFERENCES users(id),
    -- 申诉对象：一条限制，或一条针对本人的治理动作（例如商品被隐藏）
    restriction_id uuid REFERENCES user_restrictions(id),
    action_id      uuid REFERENCES moderation_actions(id),
    case_id        uuid REFERENCES moderation_cases(id),
    reason         text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500 AND reason !~ '[<>]'),
    status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
    decided_by     uuid REFERENCES users(id),
    decided_at     timestamptz,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((restriction_id IS NULL) <> (action_id IS NULL)),
    CHECK ((status = 'PENDING') = (decided_at IS NULL AND decided_by IS NULL))
);

-- 每条限制 / 动作只能申诉一次
CREATE UNIQUE INDEX moderation_appeals_once_restriction ON moderation_appeals (restriction_id) WHERE restriction_id IS NOT NULL;
CREATE UNIQUE INDEX moderation_appeals_once_action ON moderation_appeals (action_id) WHERE action_id IS NOT NULL;
CREATE INDEX moderation_appeals_queue ON moderation_appeals (school_id, status, created_at, id);
CREATE INDEX moderation_appeals_mine ON moderation_appeals (user_id, created_at DESC);

ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_appeal_fk
    FOREIGN KEY (appeal_id) REFERENCES moderation_appeals(id);

-- 申诉：只能由 PENDING 决定一次；申诉内容不可改
CREATE FUNCTION moderation_appeals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'appeals cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING' THEN
        RAISE EXCEPTION 'appeal decision is final' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.school_id, NEW.user_id, NEW.restriction_id, NEW.action_id, NEW.case_id, NEW.reason, NEW.created_at)
       IS DISTINCT FROM (OLD.school_id, OLD.user_id, OLD.restriction_id, OLD.action_id, OLD.case_id, OLD.reason, OLD.created_at) THEN
        RAISE EXCEPTION 'appeal content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER moderation_appeals_guard BEFORE UPDATE OR DELETE ON moderation_appeals
    FOR EACH ROW EXECUTE FUNCTION moderation_appeals_guard();
