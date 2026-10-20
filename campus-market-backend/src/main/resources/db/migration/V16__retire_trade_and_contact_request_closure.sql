-- 阶段 1：平台只展示商品与联系方式（V15）之后的收口。
--   1. 历史交易数据收尾：未结束的订单统一关闭、未决的爽约报告失效、爽约规则产生的自动限制撤销、
--      以订单 / 爽约为对象的未结案件结案、残留的「预约中」商品恢复在售；每一行改动都记入 legacy_trade_closures；
--   2. 交易相关表冻结为只读历史（数据库层拒绝写入，不依赖应用代码）；
--   3. 去掉订单参与者的读取例外：product_readable_by 与 product_visible_to 等价；
--   4. 新增「申请联系方式」限制范围（CONTACT）与对应的治理动作；不再接受以订单 / 爽约为对象的新举报与案件；
--   5. 联系请求：买家撤回、卖家撤回同意、决定时间、双方的已读时间，状态机由数据库守卫。
-- 只新增，不修改 V1～V15。

-- ----------------------------------------------------------------------------
-- 1. 历史交易数据收尾（审计表先建，所有改动都写一行）
-- ----------------------------------------------------------------------------

CREATE TABLE legacy_trade_closures (
    id          bigserial PRIMARY KEY,
    entity_type text NOT NULL CHECK (entity_type IN ('ORDER','NO_SHOW_REPORT','RESTRICTION','MODERATION_CASE','PRODUCT')),
    entity_id   uuid NOT NULL,
    from_status text NOT NULL,
    to_status   text NOT NULL,
    reason      text NOT NULL,
    closed_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX legacy_trade_closures_entity ON legacy_trade_closures (entity_type, entity_id);
CREATE TRIGGER legacy_trade_closures_append_only BEFORE UPDATE OR DELETE ON legacy_trade_closures
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- 1a. 未结束的订单 → EXPIRED（系统关闭，没有操作人；不是任何一方的取消，因此不写 order_cancellations）
WITH closing AS (
    SELECT id, status FROM orders
    WHERE status NOT IN ('COMPLETED','CANCELLED','EXPIRED')
    FOR UPDATE
), logged AS (
    INSERT INTO legacy_trade_closures(entity_type, entity_id, from_status, to_status, reason)
    SELECT 'ORDER', id, status, 'EXPIRED', 'PLATFORM_TRADE_RETIRED' FROM closing
), evented AS (
    INSERT INTO order_events(id, order_id, actor_id, from_status, to_status, reason)
    SELECT gen_random_uuid(), id, NULL, status, 'EXPIRED', '平台已停止站内交易，未结束的订单统一关闭' FROM closing
)
UPDATE orders o SET status = 'EXPIRED', updated_at = now()
FROM closing c WHERE o.id = c.id;

-- 1b. 未决的爽约报告 → EXPIRED（爽约规则随交易流程停用，单方报告不会再被确认或计数）
WITH closing AS (
    SELECT id, status FROM order_no_show_reports WHERE status IN ('PENDING','DISPUTED') FOR UPDATE
), logged AS (
    INSERT INTO legacy_trade_closures(entity_type, entity_id, from_status, to_status, reason)
    SELECT 'NO_SHOW_REPORT', id, status, 'EXPIRED', 'NO_SHOW_RULE_RETIRED' FROM closing
)
UPDATE order_no_show_reports r SET status = 'EXPIRED'
FROM closing c WHERE r.id = c.id;

-- 1c. 爽约规则产生、仍在生效的自动限制 → 撤销（新的撤销原因 RULE_RETIRED）
ALTER TABLE user_restrictions DROP CONSTRAINT user_restrictions_revoke_reason_check;
ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_revoke_reason_check CHECK (
    revoke_reason IS NULL OR revoke_reason IN ('APPEAL_ACCEPTED','STAFF_CORRECTION','RULE_RECOMPUTED','RULE_RETIRED'));

WITH closing AS (
    SELECT id FROM user_restrictions
    WHERE source = 'SYSTEM_RULE' AND revoked_at IS NULL AND ends_at > now()
    FOR UPDATE
), logged AS (
    INSERT INTO legacy_trade_closures(entity_type, entity_id, from_status, to_status, reason)
    SELECT 'RESTRICTION', id, 'ACTIVE', 'REVOKED', 'NO_SHOW_RULE_RETIRED' FROM closing
)
UPDATE user_restrictions r SET revoked_at = now(), revoke_reason = 'RULE_RETIRED'
FROM closing c WHERE r.id = c.id;

-- 1d. 以订单 / 爽约为对象、还没有结果的案件 → 不采取措施结案（不伪造工作人员动作；改动记入审计表）
WITH closing AS (
    SELECT id, status FROM moderation_cases
    WHERE target_type IN ('ORDER','NO_SHOW') AND status IN ('OPEN','UNDER_REVIEW')
    FOR UPDATE
), logged AS (
    INSERT INTO legacy_trade_closures(entity_type, entity_id, from_status, to_status, reason)
    SELECT 'MODERATION_CASE', id, status, 'DISMISSED', 'PLATFORM_TRADE_RETIRED' FROM closing
)
UPDATE moderation_cases m SET status = 'DISMISSED', resolution_code = 'NO_ACTION', resolved_at = clock_timestamp(),
                              updated_at = clock_timestamp()
FROM closing c WHERE m.id = c.id;

-- 1e. V15 之后如仍有「预约中」的商品（例如 V15 与本迁移之间旧代码写入），恢复在售
WITH closing AS (
    SELECT id FROM products WHERE status = '预约中' FOR UPDATE
), logged AS (
    INSERT INTO legacy_trade_closures(entity_type, entity_id, from_status, to_status, reason)
    SELECT 'PRODUCT', id, '预约中', '在售', 'PLATFORM_TRADE_RETIRED' FROM closing
)
UPDATE products p SET status = '在售'
FROM closing c WHERE p.id = c.id;

-- ----------------------------------------------------------------------------
-- 2. 交易相关表冻结为只读历史
-- ----------------------------------------------------------------------------

CREATE FUNCTION legacy_trade_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is read-only history: in-platform trading has been retired', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['orders','order_events','order_flow_events','order_cancellations','order_inspections',
                             'order_inspection_items','order_meeting_proposals','order_presence','order_no_show_reports',
                             'order_slot_agreements','reviews','user_restriction_basis','user_restriction_corrections']
    LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION legacy_trade_read_only()',
                       t || '_read_only', t);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. 去掉订单参与者的读取例外
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION product_readable_by(p_id uuid, p_visibility text, p_seller uuid, p_campus text, p_hidden_at timestamptz, viewer uuid)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT product_visible_to(p_id, p_visibility, p_seller, p_campus, p_hidden_at, viewer)
$$;

-- ----------------------------------------------------------------------------
-- 4. 「申请联系方式」限制范围；不再接受以订单 / 爽约为对象的新举报与案件
-- ----------------------------------------------------------------------------

ALTER TABLE user_restrictions DROP CONSTRAINT user_restrictions_scope_check;
ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_scope_check
    CHECK (scope IN ('BOOKING','PUBLISHING','CIRCLE_CREATION','CONTACT'));
-- BOOKING 范围与爽约规则（SYSTEM_RULE）只保留为历史：新的限制不能再用它们
CREATE FUNCTION user_restrictions_retired_kinds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.scope = 'BOOKING' THEN
        RAISE EXCEPTION 'BOOKING restrictions are retired; use CONTACT' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source = 'SYSTEM_RULE' THEN
        RAISE EXCEPTION 'the no-show rule is retired; restrictions come from staff decisions only' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER user_restrictions_retired_kinds BEFORE INSERT ON user_restrictions
    FOR EACH ROW EXECUTE FUNCTION user_restrictions_retired_kinds();

ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_action_code_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_action_code_check CHECK (action_code IN (
    'HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING','RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION',
    'RESTRICT_CONTACT','CONFIRM_NO_SHOW','REJECT_NO_SHOW','NO_ACTION','REVOKE_RESTRICTION','ACCEPT_APPEAL','REJECT_APPEAL',
    'HIDE_COMMENT','RESTORE_COMMENT','QUARANTINE_MESSAGE','RELEASE_MESSAGE'));

ALTER TABLE moderation_cases DROP CONSTRAINT moderation_cases_resolution_code_check;
ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_resolution_code_check CHECK (resolution_code IN (
    'HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING','RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION',
    'RESTRICT_CONTACT','CONFIRM_NO_SHOW','REJECT_NO_SHOW','NO_ACTION','HIDE_COMMENT','RESTORE_COMMENT','QUARANTINE_MESSAGE',
    'RELEASE_MESSAGE'));

CREATE FUNCTION moderation_no_trade_targets() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.target_type IN ('ORDER','NO_SHOW') THEN
        RAISE EXCEPTION 'orders and no-show reports are read-only history and cannot be reported' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER moderation_cases_no_trade_targets BEFORE INSERT ON moderation_cases
    FOR EACH ROW EXECUTE FUNCTION moderation_no_trade_targets();
CREATE TRIGGER moderation_reports_no_trade_targets BEFORE INSERT ON moderation_reports
    FOR EACH ROW EXECUTE FUNCTION moderation_no_trade_targets();

-- ----------------------------------------------------------------------------
-- 5. 联系请求：撤回、撤回同意、决定时间、已读时间
-- ----------------------------------------------------------------------------

ALTER TABLE contact_requests DROP CONSTRAINT contact_requests_status_check;
ALTER TABLE contact_requests ADD CONSTRAINT contact_requests_status_check
    CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','REVOKED'));
ALTER TABLE contact_requests ADD COLUMN decided_at timestamptz;
-- 卖家最近一次看到这条待处理申请的时间；买家最近一次看到决定结果的时间（站内未读数）
ALTER TABLE contact_requests ADD COLUMN seller_seen_at timestamptz;
ALTER TABLE contact_requests ADD COLUMN buyer_seen_at timestamptz;
UPDATE contact_requests SET decided_at = updated_at WHERE status IN ('APPROVED','REJECTED');
ALTER TABLE contact_requests ADD CONSTRAINT contact_requests_decided_shape
    CHECK ((status IN ('APPROVED','REJECTED','REVOKED')) = (decided_at IS NOT NULL));

CREATE FUNCTION contact_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'contact requests cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING' THEN
            RAISE EXCEPTION 'contact requests start as PENDING' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF (NEW.product_id, NEW.buyer_id, NEW.seller_id, NEW.created_at) IS DISTINCT FROM
       (OLD.product_id, OLD.buyer_id, OLD.seller_id, OLD.created_at) THEN
        RAISE EXCEPTION 'contact request identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    -- PENDING → APPROVED / REJECTED（卖家）/ WITHDRAWN（买家）；APPROVED → REVOKED（卖家撤回同意）；
    -- WITHDRAWN → PENDING（买家重新申请）；REJECTED、REVOKED 是终态
    IF NOT (OLD.status = NEW.status
            OR (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED','REJECTED','WITHDRAWN'))
            OR (OLD.status = 'APPROVED' AND NEW.status = 'REVOKED')
            OR (OLD.status = 'WITHDRAWN' AND NEW.status = 'PENDING')) THEN
        RAISE EXCEPTION 'invalid contact request status change % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER contact_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON contact_requests
    FOR EACH ROW EXECUTE FUNCTION contact_requests_guard();

-- 申请人必须与商品同校（绕过接口直接写库也会失败；与 V10 的订单同校守卫同一口径）
CREATE FUNCTION contact_requests_same_school_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF viewer_school(NEW.buyer_id) IS DISTINCT FROM (SELECT c.school_id FROM products p JOIN campuses c ON c.id = p.campus
                                                     WHERE p.id = NEW.product_id) THEN
        RAISE EXCEPTION 'contact requests must stay within one school' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER contact_requests_same_school_guard BEFORE INSERT ON contact_requests
    FOR EACH ROW EXECUTE FUNCTION contact_requests_same_school_guard();

-- 买家视角的列表与未读；卖家的待处理未读
CREATE INDEX contact_requests_buyer ON contact_requests (buyer_id, created_at DESC);
CREATE INDEX contact_requests_seller_unread ON contact_requests (seller_id) WHERE status = 'PENDING' AND seller_seen_at IS NULL;
CREATE INDEX contact_requests_buyer_unread ON contact_requests (buyer_id)
    WHERE status IN ('APPROVED','REJECTED','REVOKED') AND buyer_seen_at IS NULL;
