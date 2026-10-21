-- =============================================================================
-- V23 · 注册邀请码：首批小范围试运行（网页，安徽理工大学）只允许持邀请码注册
--
--   1. registration_invites：学校工作人员（或首次部署时的命令行）签发的邀请码。
--      只存规范化之后的 SHA-256 与末 4 位提示，明文只在签发那一次出现；
--      除「已用次数 +1」与「撤销」外任何字段都不能改，不能删除、不能 TRUNCATE。
--   2. registration_invite_uses：每次使用（邀请码、注册出的用户、时间），只增不改。
--   3. admin_read_audit 的资源白名单加入 'registration-invites'（详情会显示使用者昵称，按个人信息留痕）。
--
-- 是否要求邀请码由配置 REGISTRATION_INVITE_REQUIRED 决定（默认 false），本迁移不改变任何现有行为。
-- 只新增，不修改 V1～V22。
-- =============================================================================

CREATE TABLE registration_invites (
    id          uuid PRIMARY KEY,
    school_id   text NOT NULL REFERENCES schools(id),
    code_hash   text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    -- 规范化之后的末 4 位，只用于在后台辨认是哪一张
    code_hint   text NOT NULL CHECK (code_hint ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'),
    max_uses    integer NOT NULL CHECK (max_uses BETWEEN 1 AND 500),
    used_count  integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at  timestamptz NOT NULL,
    note        text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 100),
    -- NULL = 由命令行签发（首次部署时还没有任何工作人员）
    created_by  uuid REFERENCES users(id),
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at  timestamptz,
    revoked_by  uuid REFERENCES users(id),
    CHECK (used_count <= max_uses),
    -- 最长 90 天；按小时计，不受会话时区夏令时影响（每次 UPDATE 都会重新检查）
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '2160 hours'),
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX registration_invites_school_created ON registration_invites (school_id, created_at DESC, id DESC);

CREATE FUNCTION registration_invites_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'registration invites cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.id, NEW.school_id, NEW.code_hash, NEW.code_hint, NEW.max_uses, NEW.expires_at, NEW.note, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.school_id, OLD.code_hash, OLD.code_hint, OLD.max_uses, OLD.expires_at, OLD.note, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION 'registration invite content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    -- 已用次数只能每次 +1，且撤销之后不能再用
    IF NEW.used_count <> OLD.used_count AND (NEW.used_count <> OLD.used_count + 1 OR OLD.revoked_at IS NOT NULL) THEN
        RAISE EXCEPTION 'registration invite uses only increment by one while not revoked' USING ERRCODE = 'check_violation';
    END IF;
    -- 撤销是终态
    IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at, NEW.revoked_by) IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by) THEN
        RAISE EXCEPTION 'registration invite revocation is final' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER registration_invites_guard BEFORE UPDATE OR DELETE ON registration_invites
    FOR EACH ROW EXECUTE FUNCTION registration_invites_guard();
CREATE TRIGGER registration_invites_no_truncate BEFORE TRUNCATE ON registration_invites
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();

CREATE TABLE registration_invite_uses (
    id         bigserial PRIMARY KEY,
    invite_id  uuid NOT NULL REFERENCES registration_invites(id),
    -- 一个账号只会注册一次
    user_id    uuid NOT NULL UNIQUE REFERENCES users(id),
    used_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX registration_invite_uses_invite ON registration_invite_uses (invite_id, used_at, id);

-- 每条使用记录都必须对应一次已经计入 used_count 的使用（应用在同一事务里先 +1 再记录）
CREATE FUNCTION registration_invite_uses_counted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM registration_invite_uses WHERE invite_id = NEW.invite_id)
       >= (SELECT used_count FROM registration_invites WHERE id = NEW.invite_id) THEN
        RAISE EXCEPTION 'registration invite use was not counted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER registration_invite_uses_counted BEFORE INSERT ON registration_invite_uses
    FOR EACH ROW EXECUTE FUNCTION registration_invite_uses_counted();
CREATE TRIGGER registration_invite_uses_append_only BEFORE UPDATE OR DELETE ON registration_invite_uses
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER registration_invite_uses_no_truncate BEFORE TRUNCATE ON registration_invite_uses
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();

-- 后台读取留痕的资源白名单（V17）加入注册邀请码
ALTER TABLE admin_read_audit DROP CONSTRAINT admin_read_audit_resource_check;
ALTER TABLE admin_read_audit ADD CONSTRAINT admin_read_audit_resource_check
    CHECK (resource IN ('users','orders','audit','role-requests','read-audit','registration-invites'));
