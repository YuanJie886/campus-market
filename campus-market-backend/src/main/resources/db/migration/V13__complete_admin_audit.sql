-- V12 已扩展后台角色；本迁移补齐后台授权接口所需的审计表。
-- 使用新的版本修复，保持已执行的 V12 内容与校验和不变。
-- 部分旧库已创建审计对象，升级时复用它们并保留原有记录。
CREATE TABLE IF NOT EXISTS admin_staff_audit (
    id uuid PRIMARY KEY,
    school_id text NOT NULL REFERENCES schools(id),
    staff_user_id uuid NOT NULL REFERENCES users(id),
    target_user_id uuid NOT NULL REFERENCES users(id),
    old_role text CHECK (old_role IS NULL OR old_role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN','AUDITOR')),
    new_role text NOT NULL CHECK (new_role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN','AUDITOR')),
    old_active boolean,
    new_active boolean NOT NULL,
    note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500),
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (staff_user_id <> target_user_id)
);
CREATE INDEX IF NOT EXISTS admin_staff_audit_school_created ON admin_staff_audit(school_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admin_staff_audit_school_target ON admin_staff_audit(school_id, target_user_id);

CREATE OR REPLACE FUNCTION admin_staff_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'staff audit records are immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE OR REPLACE TRIGGER admin_staff_audit_immutable
    BEFORE UPDATE OR DELETE ON admin_staff_audit FOR EACH ROW EXECUTE FUNCTION admin_staff_audit_immutable();

-- 只读审计员不可处理案件或申诉，不能计入可处理工作人员人数。
CREATE OR REPLACE FUNCTION eligible_staff_for_case(p_case uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM moderation_cases c JOIN staff_members s ON s.school_id = c.school_id
    WHERE c.id = p_case AND s.active AND s.role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN')
        AND s.school_id = viewer_school(s.user_id) AND staff_case_conflict(c.id, s.user_id) IS NULL
$$;
CREATE OR REPLACE FUNCTION eligible_staff_for_appeal(p_appeal uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM moderation_appeals a JOIN staff_members s ON s.school_id = a.school_id
    WHERE a.id = p_appeal AND s.active AND s.role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN')
        AND s.school_id = viewer_school(s.user_id) AND staff_appeal_conflict(a.id, s.user_id) IS NULL
$$;
