-- 阶段 2：运营后台安全。
--   1. 学校管理员（SCHOOL_ADMIN）的授予、降级与停用需要两人：一人发起、另一位本校学校管理员确认；
--   2. 每所学校至少保留一名在岗学校管理员（数据库兜底，按学校行加锁串行化）；
--   3. 后台读取个人信息留痕（只记录谁、何时、读了哪类记录，不记录搜索原文）；
--   4. 审计与治理历史禁止 TRUNCATE；
--   5. 利益回避：有联系申请往来的工作人员不能处理该商品的案件（新原因 CONTACT_PARTY），后台商品管理同一口径。
-- 只新增，不修改 V1～V16。

-- ----------------------------------------------------------------------------
-- 1. 两人复核
-- ----------------------------------------------------------------------------

CREATE TABLE admin_role_requests (
    id             uuid PRIMARY KEY,
    school_id      text NOT NULL REFERENCES schools(id),
    target_user_id uuid NOT NULL REFERENCES users(id),
    requested_by   uuid NOT NULL REFERENCES users(id),
    old_role       text CHECK (old_role IS NULL OR old_role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN','AUDITOR')),
    old_active     boolean,
    new_role       text NOT NULL CHECK (new_role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN','AUDITOR')),
    new_active     boolean NOT NULL,
    note           text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500),
    request_id     text NOT NULL,
    status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')),
    decided_by     uuid REFERENCES users(id),
    decision_note  text CHECK (decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 1 AND 500),
    decided_at     timestamptz,
    expires_at     timestamptz NOT NULL DEFAULT clock_timestamp() + interval '72 hours',
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (requested_by <> target_user_id),
    -- 确认人不能是发起人，也不能是被授权人本人
    CHECK (decided_by IS NULL OR (decided_by <> requested_by AND decided_by <> target_user_id)),
    CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CHECK (status NOT IN ('APPROVED','REJECTED') OR decided_by IS NOT NULL),
    -- 只有涉及学校管理员的变更才走两人复核
    CHECK (old_role = 'SCHOOL_ADMIN' OR new_role = 'SCHOOL_ADMIN')
);
CREATE UNIQUE INDEX admin_role_requests_one_pending ON admin_role_requests (target_user_id) WHERE status = 'PENDING';
CREATE INDEX admin_role_requests_school ON admin_role_requests (school_id, status, created_at DESC);

CREATE FUNCTION admin_role_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'role requests cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.school_id, NEW.target_user_id, NEW.requested_by, NEW.old_role, NEW.old_active, NEW.new_role, NEW.new_active,
        NEW.note, NEW.request_id, NEW.expires_at, NEW.created_at) IS DISTINCT FROM
       (OLD.school_id, OLD.target_user_id, OLD.requested_by, OLD.old_role, OLD.old_active, OLD.new_role, OLD.new_active,
        OLD.note, OLD.request_id, OLD.expires_at, OLD.created_at) THEN
        RAISE EXCEPTION 'role request content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING' THEN
        RAISE EXCEPTION 'decided role requests are final' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER admin_role_requests_guard BEFORE UPDATE OR DELETE ON admin_role_requests
    FOR EACH ROW EXECUTE FUNCTION admin_role_requests_guard();

-- 审计记录同时写明确认人与对应的复核请求（两人复核的变更必须两者都有）
ALTER TABLE admin_staff_audit ADD COLUMN confirmed_by uuid REFERENCES users(id);
ALTER TABLE admin_staff_audit ADD COLUMN role_request_id uuid REFERENCES admin_role_requests(id);
ALTER TABLE admin_staff_audit ADD CONSTRAINT admin_staff_audit_two_person
    CHECK ((confirmed_by IS NULL) = (role_request_id IS NULL) AND (confirmed_by IS NULL OR confirmed_by <> staff_user_id));

-- ----------------------------------------------------------------------------
-- 2. 至少一名在岗学校管理员
-- ----------------------------------------------------------------------------

CREATE FUNCTION staff_members_last_admin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.role = 'SCHOOL_ADMIN' AND OLD.active
       AND (TG_OP = 'DELETE' OR NOT (NEW.role = 'SCHOOL_ADMIN' AND NEW.active AND NEW.school_id = OLD.school_id)) THEN
        -- 按学校行加锁：两位学校管理员同时互相降级时，后一个会看到前一个已提交的结果
        PERFORM 1 FROM schools WHERE id = OLD.school_id FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM staff_members s WHERE s.school_id = OLD.school_id AND s.role = 'SCHOOL_ADMIN' AND s.active
                                                       AND s.user_id <> OLD.user_id) THEN
            RAISE EXCEPTION 'a school must keep at least one active school admin' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER staff_members_last_admin_guard BEFORE UPDATE OR DELETE ON staff_members
    FOR EACH ROW EXECUTE FUNCTION staff_members_last_admin_guard();

-- ----------------------------------------------------------------------------
-- 3. 后台读取个人信息留痕
-- ----------------------------------------------------------------------------

CREATE TABLE admin_read_audit (
    id             bigserial PRIMARY KEY,
    school_id      text NOT NULL REFERENCES schools(id),
    staff_user_id  uuid NOT NULL REFERENCES users(id),
    resource       text NOT NULL CHECK (resource IN ('users','orders','audit','role-requests','read-audit')),
    -- 详情时为记录 id；列表（含导出）时为空
    record_id      uuid,
    -- 列表：返回条数与是否带搜索词；搜索原文可能就是个人信息，只记录它的 SHA-256
    result_count   integer CHECK (result_count IS NULL OR result_count >= 0),
    query_digest   text CHECK (query_digest IS NULL OR query_digest ~ '^[0-9a-f]{64}$'),
    request_id     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_read_audit_school_created ON admin_read_audit (school_id, created_at DESC, id DESC);
CREATE INDEX admin_read_audit_staff ON admin_read_audit (staff_user_id, created_at DESC);
CREATE TRIGGER admin_read_audit_append_only BEFORE UPDATE OR DELETE ON admin_read_audit
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- ----------------------------------------------------------------------------
-- 4. 审计与治理历史禁止 TRUNCATE（UPDATE / DELETE 已由各表的行级守卫拒绝）
-- ----------------------------------------------------------------------------

CREATE FUNCTION audit_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is an audit / history table and cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['admin_staff_audit','admin_product_audit','admin_read_audit','admin_role_requests',
                             'moderation_cases','moderation_reports','moderation_actions','moderation_appeals',
                             'user_restrictions','legacy_trade_closures','contact_requests',
                             'orders','order_events','order_flow_events','order_cancellations','order_inspections',
                             'order_inspection_items','order_meeting_proposals','order_presence','order_no_show_reports',
                             'order_slot_agreements','reviews','user_restriction_basis','user_restriction_corrections']
    LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate()',
                       t || '_no_truncate', t);
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 利益回避：联系申请的买卖双方
-- ----------------------------------------------------------------------------

-- 商品的直接管理（后台编辑 / 隐藏 / 恢复）：本人商品、本人举报过、与它有联系申请往来
CREATE FUNCTION staff_product_conflict(p_product uuid, p_staff uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = p_product AND p.seller_id = p_staff) THEN 'OWN_CONTENT'
        WHEN EXISTS (SELECT 1 FROM contact_requests r WHERE r.product_id = p_product AND r.buyer_id = p_staff) THEN 'CONTACT_PARTY'
        WHEN EXISTS (SELECT 1 FROM moderation_reports r WHERE r.target_type = 'PRODUCT' AND r.target_id = p_product
                                                         AND r.reporter_user_id = p_staff) THEN 'OWN_REPORT'
    END
$$;

-- 案件：在 V11 的判断之外，商品案件里申请过这件商品联系方式的工作人员同样回避
CREATE OR REPLACE FUNCTION staff_case_conflict(p_case uuid, p_staff uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN c.target_type = 'USER' AND c.target_id = p_staff THEN 'SELF_TARGET'
        WHEN c.target_type = 'PRODUCT' AND EXISTS (SELECT 1 FROM products p WHERE p.id = c.target_id AND p.seller_id = p_staff)
            THEN 'OWN_CONTENT'
        WHEN c.target_type = 'COMMENT' AND EXISTS (SELECT 1 FROM comments cm WHERE cm.id = c.target_id AND cm.user_id = p_staff)
            THEN 'OWN_CONTENT'
        WHEN c.target_type = 'MESSAGE' AND EXISTS (SELECT 1 FROM messages m WHERE m.id = c.target_id AND m.sender_id = p_staff)
            THEN 'OWN_CONTENT'
        WHEN c.target_type = 'MESSAGE' AND EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
                                                   WHERE m.id = c.target_id AND p_staff IN (cv.buyer_id, cv.seller_id))
            THEN 'OWN_CONVERSATION'
        WHEN c.target_type = 'CIRCLE' AND EXISTS (SELECT 1 FROM circles ci WHERE ci.id = c.target_id AND ci.owner_user_id = p_staff)
            THEN 'OWN_CONTENT'
        WHEN c.target_type = 'PRODUCT' AND EXISTS (SELECT 1 FROM contact_requests r WHERE r.product_id = c.target_id AND r.buyer_id = p_staff)
            THEN 'CONTACT_PARTY'
        WHEN c.target_type = 'ORDER' AND EXISTS (SELECT 1 FROM orders o WHERE o.id = c.target_id AND p_staff IN (o.buyer_id, o.seller_id))
            THEN 'OWN_ORDER'
        WHEN c.target_type = 'NO_SHOW' AND EXISTS (SELECT 1 FROM order_no_show_reports n JOIN orders o ON o.id = n.order_id
                                                   WHERE n.id = c.target_id AND p_staff IN (o.buyer_id, o.seller_id))
            THEN 'OWN_ORDER'
        WHEN EXISTS (SELECT 1 FROM moderation_reports r WHERE r.case_id = c.id AND r.reporter_user_id = p_staff)
            THEN 'OWN_REPORT'
    END
    FROM moderation_cases c WHERE c.id = p_case
$$;
