-- ============================================================================
-- V11：治理规则收口（模块 7.1）
--
--   7.1A 明确档期：新预约必须保存明确的开始与结束时间；卖家接单 / 改约被接受时由触发器写入
--        「档期快照」（order_slot_agreements），之后档期冻结；爽约报告与确认只认快照，
--        没有快照的旧订单（原始预约没有结束时间）不能据此报告、承认或确认爽约，也不补写任何结束时间。
--   7.1B 自动限制：来源统一为 SYSTEM_RULE，保存规则版本、决定时间与所依据的确认记录；
--        申诉推翻某次确认后，受影响且未到期的自动限制只能缩短或撤销，并追加纠正记录。
--   7.1C 利益回避：由数据库函数给出工作人员与案件 / 申诉之间的利益冲突，后端据此拒绝处理。
--   7.1E 内容处置：评论可隐藏 / 恢复，被举报的单条私信可隔离 / 解除；原文保留，不物理删除。
--
-- V1～V10 不修改。本文件只新增表、列、函数、触发器与约束；唯一的数据改写是把 V10 的
-- 'NO_SHOW_RULE' 来源改名为 'SYSTEM_RULE' 并补齐规则版本与依据（见第 2 节）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 7.1A 明确档期
-- ----------------------------------------------------------------------------

-- 双方确认过的档期快照：revision 0 = 卖家接受买家提交的原始预约；revision N = 第 N 次被接受的改约
CREATE TABLE order_slot_agreements (
    order_id         uuid NOT NULL REFERENCES orders(id),
    meeting_revision integer NOT NULL CHECK (meeting_revision >= 0),
    meeting_point_id text NOT NULL,
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    source           text NOT NULL CHECK (source IN ('SELLER_ACCEPTED_BOOKING','PROPOSAL_ACCEPTED','LEGACY_ACCEPTED_PROPOSAL')),
    agreed_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (order_id, meeting_revision),
    -- 与 V5 orders_meeting_window_check、改约提议同一上限：单次面交最长 2 小时
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '2 hours')
);

CREATE TRIGGER order_slot_agreements_append_only BEFORE UPDATE OR DELETE ON order_slot_agreements
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- 旧数据只回填真实存在的双方协议：被接受过的改约提议本来就有完整的开始与结束时间。
-- 原始预约（revision 0）在 V11 之前从未保存结束时间，这里不推断、不补写。
INSERT INTO order_slot_agreements(order_id, meeting_revision, meeting_point_id, starts_at, ends_at, source, agreed_at)
SELECT pr.order_id, pr.revision, pr.meeting_point_id, pr.starts_at, pr.ends_at, 'LEGACY_ACCEPTED_PROPOSAL',
       COALESCE(pr.responded_at, pr.created_at)
FROM order_meeting_proposals pr
WHERE pr.revision IS NOT NULL AND pr.revision >= 1;

-- 订单上的档期：新预约必须带结束时间；档期（时间与地点）只能随改约握手（revision 增加）变化
CREATE FUNCTION orders_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'PENDING_SELLER_CONFIRM' AND NEW.meeting_ends_at IS NULL THEN
            RAISE EXCEPTION 'new bookings need an explicit end time' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.meeting_revision < OLD.meeting_revision THEN
        RAISE EXCEPTION 'meeting revision cannot go back' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.meeting_at, NEW.meeting_ends_at, NEW.meeting_point_id) IS DISTINCT FROM
       (OLD.meeting_at, OLD.meeting_ends_at, OLD.meeting_point_id)
       AND NEW.meeting_revision = OLD.meeting_revision THEN
        RAISE EXCEPTION 'agreed slot is frozen; change it through an accepted proposal' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER orders_slot_guard BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_slot_guard();

-- 卖家接单（revision 0）或改约被接受（revision 增加）时写入快照；没有结束时间的旧预约不写
CREATE FUNCTION orders_record_slot_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.meeting_ends_at IS NOT NULL AND (
           (OLD.status = 'PENDING_SELLER_CONFIRM' AND NEW.status = 'PENDING_MEETING' AND NEW.meeting_revision = 0)
        OR NEW.meeting_revision > OLD.meeting_revision) THEN
        INSERT INTO order_slot_agreements(order_id, meeting_revision, meeting_point_id, starts_at, ends_at, source)
        VALUES (NEW.id, NEW.meeting_revision, NEW.meeting_point_id, NEW.meeting_at, NEW.meeting_ends_at,
                CASE WHEN NEW.meeting_revision = 0 THEN 'SELLER_ACCEPTED_BOOKING' ELSE 'PROPOSAL_ACCEPTED' END)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER orders_record_slot_agreement AFTER UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION orders_record_slot_agreement();

-- 爽约报告与「承认 / 确认」只针对有快照的档期：直接写库也无法绕过
CREATE FUNCTION order_no_show_reports_slot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (TG_OP = 'INSERT'
        OR (NEW.status IN ('ACKNOWLEDGED','CONFIRMED') AND OLD.status NOT IN ('ACKNOWLEDGED','CONFIRMED')))
       AND NOT EXISTS (SELECT 1 FROM order_slot_agreements a
                       WHERE a.order_id = NEW.order_id AND a.meeting_revision = NEW.meeting_revision) THEN
        RAISE EXCEPTION 'no-show needs an explicit agreed slot' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_no_show_reports_slot_guard BEFORE INSERT OR UPDATE OF status ON order_no_show_reports
    FOR EACH ROW EXECUTE FUNCTION order_no_show_reports_slot_guard();

-- 30 天计数只数「有快照的已确认」：覆盖订单与档期版本，窗口查询只读已确认的行，再按快照主键判断
CREATE INDEX order_no_show_reports_confirmed_slot ON order_no_show_reports (reported_user_id, confirmed_at)
    INCLUDE (order_id, meeting_revision) WHERE status IN ('ACKNOWLEDGED','CONFIRMED');

-- ----------------------------------------------------------------------------
-- 2. 7.1B 自动限制：来源、规则版本、依据与纠正
-- ----------------------------------------------------------------------------

ALTER TABLE user_restrictions DROP CONSTRAINT user_restrictions_source_check;
ALTER TABLE user_restrictions DROP CONSTRAINT user_restrictions_check1;
ALTER TABLE user_restrictions DROP CONSTRAINT user_restrictions_revoke_reason_check;

ALTER TABLE user_restrictions ADD COLUMN rule_version text;
ALTER TABLE user_restrictions ADD COLUMN decided_at timestamptz;
ALTER TABLE user_restrictions ADD COLUMN last_correction_id uuid;

-- 一次性改名：V10 的 NO_SHOW_RULE 即第一版公开规则。只在本迁移里临时停用守卫，之后立即恢复
ALTER TABLE user_restrictions DISABLE TRIGGER user_restrictions_guard;
UPDATE user_restrictions SET source = 'SYSTEM_RULE', rule_version = 'NO_SHOW_V1', decided_at = created_at
WHERE source = 'NO_SHOW_RULE';
UPDATE user_restrictions SET decided_at = created_at WHERE decided_at IS NULL;
ALTER TABLE user_restrictions ENABLE TRIGGER user_restrictions_guard;

ALTER TABLE user_restrictions ALTER COLUMN decided_at SET DEFAULT clock_timestamp();
ALTER TABLE user_restrictions ALTER COLUMN decided_at SET NOT NULL;
ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_source_check CHECK (source IN ('CASE','SYSTEM_RULE'));
-- CASE：工作人员在案件里的决定；SYSTEM_RULE：公开规则按确认记录自动生成（必有来源报告与规则版本）
ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_source_shape CHECK (
       (source = 'CASE' AND case_id IS NOT NULL AND created_by IS NOT NULL AND rule_version IS NULL)
    OR (source = 'SYSTEM_RULE' AND no_show_report_id IS NOT NULL AND rule_version IS NOT NULL));
ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_revoke_reason_check CHECK (
    revoke_reason IS NULL OR revoke_reason IN ('APPEAL_ACCEPTED','STAFF_CORRECTION','RULE_RECOMPUTED'));

-- 自动限制所依据的确认记录（决定时刻的快照：之后即使那次确认被推翻，依据仍可追溯）
CREATE TABLE user_restriction_basis (
    restriction_id    uuid NOT NULL REFERENCES user_restrictions(id),
    no_show_report_id uuid NOT NULL REFERENCES order_no_show_reports(id),
    confirmed_at      timestamptz NOT NULL,
    PRIMARY KEY (restriction_id, no_show_report_id)
);
CREATE INDEX user_restriction_basis_report ON user_restriction_basis (no_show_report_id);

CREATE TRIGGER user_restriction_basis_append_only BEFORE UPDATE OR DELETE ON user_restriction_basis
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- V10 期间生成的自动限制：依据按同一口径回填——来源报告，加上决定时刻之前 30 天内仍处于已确认状态的报告
INSERT INTO user_restriction_basis(restriction_id, no_show_report_id, confirmed_at)
SELECT r.id, r.no_show_report_id, COALESCE(n.confirmed_at, r.created_at)
FROM user_restrictions r JOIN order_no_show_reports n ON n.id = r.no_show_report_id
WHERE r.source = 'SYSTEM_RULE'
UNION
SELECT r.id, n.id, n.confirmed_at
FROM user_restrictions r JOIN order_no_show_reports n ON n.reported_user_id = r.user_id
WHERE r.source = 'SYSTEM_RULE' AND n.status IN ('ACKNOWLEDGED','CONFIRMED')
  AND n.confirmed_at > r.created_at - interval '30 days' AND n.confirmed_at <= r.created_at;

-- 纠正记录：只增不改。一条限制因同一次被推翻的确认至多纠正一次
CREATE TABLE user_restriction_corrections (
    id               uuid PRIMARY KEY,
    restriction_id   uuid NOT NULL REFERENCES user_restrictions(id),
    school_id        text NOT NULL REFERENCES schools(id),
    cause_report_id  uuid NOT NULL REFERENCES order_no_show_reports(id),
    appeal_id        uuid REFERENCES moderation_appeals(id),
    decided_by       uuid REFERENCES users(id),
    outcome          text NOT NULL CHECK (outcome IN ('SHORTENED','REVOKED')),
    rule_version     text NOT NULL,
    remaining_count  integer NOT NULL CHECK (remaining_count >= 0),
    previous_ends_at timestamptz NOT NULL,
    new_ends_at      timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- 只减轻或撤销，不加重
    CHECK (new_ends_at <= previous_ends_at),
    UNIQUE (restriction_id, cause_report_id)
);
CREATE INDEX user_restriction_corrections_restriction ON user_restriction_corrections (restriction_id, created_at);

CREATE TRIGGER user_restriction_corrections_append_only BEFORE UPDATE OR DELETE ON user_restriction_corrections
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();

ALTER TABLE user_restrictions ADD CONSTRAINT user_restrictions_last_correction_fk
    FOREIGN KEY (last_correction_id) REFERENCES user_restriction_corrections(id);

-- 限制守卫（替换 V10 的函数体；V10 文件不变）：
--   · 不可删除；已撤销的不可再改；
--   · 身份、来源、依据、开始时间不可改；
--   · 撤销只能一次；因重算撤销（RULE_RECOMPUTED）必须同时指向一条 REVOKED 纠正记录；
--   · 结束时间只能由 SYSTEM_RULE 限制按一条 SHORTENED 纠正记录缩短，不能延长。
CREATE OR REPLACE FUNCTION user_restrictions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'restrictions cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'revoked restrictions are immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.user_id, NEW.school_id, NEW.scope, NEW.source, NEW.case_id, NEW.no_show_report_id, NEW.created_by,
        NEW.reason_code, NEW.starts_at, NEW.created_at, NEW.rule_version, NEW.decided_at)
       IS DISTINCT FROM
       (OLD.user_id, OLD.school_id, OLD.scope, OLD.source, OLD.case_id, OLD.no_show_report_id, OLD.created_by,
        OLD.reason_code, OLD.starts_at, OLD.created_at, OLD.rule_version, OLD.decided_at) THEN
        RAISE EXCEPTION 'only revocation or a recorded correction may change a restriction' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
        IF OLD.source <> 'SYSTEM_RULE' OR NEW.ends_at > OLD.ends_at OR NEW.revoked_at IS NOT NULL
           OR NEW.last_correction_id IS NOT DISTINCT FROM OLD.last_correction_id
           OR NOT EXISTS (SELECT 1 FROM user_restriction_corrections c
                          WHERE c.id = NEW.last_correction_id AND c.restriction_id = NEW.id
                            AND c.outcome = 'SHORTENED' AND c.new_ends_at = NEW.ends_at) THEN
            RAISE EXCEPTION 'automatic restrictions may only be shortened by a recorded correction' USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.last_correction_id IS DISTINCT FROM OLD.last_correction_id OR NEW.revoke_reason = 'RULE_RECOMPUTED' THEN
        IF OLD.source <> 'SYSTEM_RULE' OR NEW.revoked_at IS NULL OR NEW.revoke_reason IS DISTINCT FROM 'RULE_RECOMPUTED'
           OR NEW.last_correction_id IS NOT DISTINCT FROM OLD.last_correction_id
           OR NOT EXISTS (SELECT 1 FROM user_restriction_corrections c
                          WHERE c.id = NEW.last_correction_id AND c.restriction_id = NEW.id AND c.outcome = 'REVOKED') THEN
            RAISE EXCEPTION 'recomputed revocation must reference its correction' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 3. 7.1E 内容处置：评论隐藏、单条私信隔离（原文保留）
-- ----------------------------------------------------------------------------

ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_action_code_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_action_code_check CHECK (action_code IN (
    'HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING','RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION',
    'CONFIRM_NO_SHOW','REJECT_NO_SHOW','NO_ACTION','REVOKE_RESTRICTION','ACCEPT_APPEAL','REJECT_APPEAL',
    'HIDE_COMMENT','RESTORE_COMMENT','QUARANTINE_MESSAGE','RELEASE_MESSAGE'));

ALTER TABLE moderation_cases DROP CONSTRAINT moderation_cases_resolution_code_check;
ALTER TABLE moderation_cases ADD CONSTRAINT moderation_cases_resolution_code_check CHECK (resolution_code IN (
    'HIDE_PRODUCT','RESTORE_PRODUCT','ARCHIVE_CIRCLE','RESTRICT_BOOKING','RESTRICT_PUBLISHING','RESTRICT_CIRCLE_CREATION',
    'CONFIRM_NO_SHOW','REJECT_NO_SHOW','NO_ACTION','HIDE_COMMENT','RESTORE_COMMENT','QUARANTINE_MESSAGE','RELEASE_MESSAGE'));

-- 动作涉及的用户（被隐藏内容的作者、被确认爽约的人、被限制的人）：用于「我的限制」列出与本人有关、可申诉的处理。
-- V10 已有的动作一次性回填（只在本迁移里临时停用只增不改守卫，之后立即恢复）
ALTER TABLE moderation_actions ADD COLUMN subject_user_id uuid REFERENCES users(id);
ALTER TABLE moderation_actions DISABLE TRIGGER moderation_actions_append_only;
UPDATE moderation_actions a SET subject_user_id = p.seller_id FROM products p
WHERE a.target_type = 'PRODUCT' AND p.id = a.target_id;
UPDATE moderation_actions a SET subject_user_id = n.reported_user_id FROM order_no_show_reports n
WHERE a.target_type = 'NO_SHOW' AND n.id = a.target_id;
UPDATE moderation_actions a SET subject_user_id = r.user_id FROM user_restrictions r
WHERE a.subject_user_id IS NULL AND a.restriction_id = r.id;
ALTER TABLE moderation_actions ENABLE TRIGGER moderation_actions_append_only;
CREATE INDEX moderation_actions_subject ON moderation_actions (subject_user_id, created_at DESC) WHERE subject_user_id IS NOT NULL;

ALTER TABLE comments ADD COLUMN moderation_hidden_at timestamptz;
ALTER TABLE comments ADD COLUMN moderation_hidden_action_id uuid REFERENCES moderation_actions(id);
ALTER TABLE messages ADD COLUMN moderation_quarantined_at timestamptz;
ALTER TABLE messages ADD COLUMN moderation_quarantine_action_id uuid REFERENCES moderation_actions(id);

-- 正文不可改写；处置过的评论 / 消息不可删除（隐藏 ≠ 删除，原文作为证据保留）
CREATE FUNCTION comments_moderation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.moderation_hidden_action_id IS NOT NULL THEN
            RAISE EXCEPTION 'moderated comments cannot be deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.id, NEW.product_id, NEW.user_id, NEW.content, NEW.parent_id, NEW.created_at) IS DISTINCT FROM
       (OLD.id, OLD.product_id, OLD.user_id, OLD.content, OLD.parent_id, OLD.created_at) THEN
        RAISE EXCEPTION 'comment content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.moderation_hidden_at IS NULL) = (OLD.moderation_hidden_at IS NULL)
       AND NEW.moderation_hidden_action_id IS DISTINCT FROM OLD.moderation_hidden_action_id THEN
        RAISE EXCEPTION 'comment moderation must change visibility' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER comments_moderation_guard BEFORE UPDATE OR DELETE ON comments
    FOR EACH ROW EXECUTE FUNCTION comments_moderation_guard();

CREATE FUNCTION messages_moderation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.moderation_quarantine_action_id IS NOT NULL THEN
            RAISE EXCEPTION 'moderated messages cannot be deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.id, NEW.conversation_id, NEW.sender_id, NEW.content, NEW.created_at) IS DISTINCT FROM
       (OLD.id, OLD.conversation_id, OLD.sender_id, OLD.content, OLD.created_at) THEN
        RAISE EXCEPTION 'message content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.moderation_quarantined_at IS NULL) = (OLD.moderation_quarantined_at IS NULL)
       AND NEW.moderation_quarantine_action_id IS DISTINCT FROM OLD.moderation_quarantine_action_id THEN
        RAISE EXCEPTION 'message moderation must change visibility' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER messages_moderation_guard BEFORE UPDATE OR DELETE ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_moderation_guard();

-- ----------------------------------------------------------------------------
-- 4. 7.1C 工作人员利益回避（权威判断在数据库；后端每次处理前调用）
-- ----------------------------------------------------------------------------

-- 返回冲突原因码；NULL = 没有冲突
CREATE FUNCTION staff_case_conflict(p_case uuid, p_staff uuid) RETURNS text LANGUAGE sql STABLE AS $$
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

CREATE FUNCTION staff_appeal_conflict(p_appeal uuid, p_staff uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN a.user_id = p_staff THEN 'SELF_TARGET'
        WHEN r.created_by = p_staff OR act.staff_user_id = p_staff OR n.decided_by = p_staff THEN 'OWN_ACTION'
        WHEN a.case_id IS NOT NULL AND EXISTS (SELECT 1 FROM moderation_actions x
                                              WHERE x.case_id = a.case_id AND x.appeal_id IS NULL AND x.staff_user_id = p_staff)
            THEN 'OWN_ACTION'
        WHEN n.reporter_user_id = p_staff THEN 'OWN_REPORT'
        WHEN n.id IS NOT NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.id = n.order_id AND p_staff IN (o.buyer_id, o.seller_id))
            THEN 'OWN_ORDER'
        WHEN a.case_id IS NOT NULL THEN staff_case_conflict(a.case_id, p_staff)
    END
    FROM moderation_appeals a
    LEFT JOIN user_restrictions r ON r.id = a.restriction_id
    LEFT JOIN moderation_actions act ON act.id = a.action_id
    LEFT JOIN order_no_show_reports n
           ON n.id = COALESCE(r.no_show_report_id, CASE WHEN act.action_code = 'CONFIRM_NO_SHOW' THEN act.target_id END)
    WHERE a.id = p_appeal
$$;

-- 本校没有利益冲突、仍在岗的工作人员人数（0 = 保持待处理，界面给出明确状态）
CREATE FUNCTION eligible_staff_for_case(p_case uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM moderation_cases c JOIN staff_members s ON s.school_id = c.school_id
    WHERE c.id = p_case AND s.active AND s.school_id = viewer_school(s.user_id) AND staff_case_conflict(c.id, s.user_id) IS NULL
$$;

CREATE FUNCTION eligible_staff_for_appeal(p_appeal uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM moderation_appeals a JOIN staff_members s ON s.school_id = a.school_id
    WHERE a.id = p_appeal AND s.active AND s.school_id = viewer_school(s.user_id) AND staff_appeal_conflict(a.id, s.user_id) IS NULL
$$;
