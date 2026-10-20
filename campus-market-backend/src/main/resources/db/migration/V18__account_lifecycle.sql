-- 阶段 3：账号体系。
--   1. 修改密码、工作人员协助的一次性重置码（没有邮件 / 短信通道时的人工找回流程）；
--   2. 注销账号：匿名化本人资料、下架商品、清除联系方式，只留不含个人信息的审计；
--   3. 微信登录：小程序 code2session 换得的 openid 绑定到已有账号（只保存 openid / unionid，不保存 session_key）。
-- 只新增，不修改 V1～V17。

ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE users ADD COLUMN deleted_at timestamptz;

-- ----------------------------------------------------------------------------
-- 1. 一次性重置码（只存 SHA-256；30 分钟内有效；最多 5 次错误；同一用户同时只有一张有效的）
-- ----------------------------------------------------------------------------

CREATE TABLE password_reset_tickets (
    id          uuid PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id),
    school_id   text NOT NULL REFERENCES schools(id),
    issued_by   uuid NOT NULL REFERENCES users(id),
    code_hash   text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    note        text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500 AND note !~ '[<>]'),
    request_id  text NOT NULL,
    attempts    integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (issued_by <> user_id),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);
CREATE UNIQUE INDEX password_reset_tickets_one_open ON password_reset_tickets (user_id) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX password_reset_tickets_school ON password_reset_tickets (school_id, created_at DESC);

CREATE FUNCTION password_reset_tickets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reset tickets cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.user_id, NEW.school_id, NEW.issued_by, NEW.code_hash, NEW.note, NEW.request_id, NEW.expires_at, NEW.created_at)
       IS DISTINCT FROM (OLD.user_id, OLD.school_id, OLD.issued_by, OLD.code_hash, OLD.note, OLD.request_id, OLD.expires_at, OLD.created_at) THEN
        RAISE EXCEPTION 'reset ticket content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.used_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'used or revoked reset tickets are final' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.attempts < OLD.attempts THEN
        RAISE EXCEPTION 'reset attempts cannot go back' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER password_reset_tickets_guard BEFORE UPDATE OR DELETE ON password_reset_tickets
    FOR EACH ROW EXECUTE FUNCTION password_reset_tickets_guard();
CREATE TRIGGER password_reset_tickets_no_truncate BEFORE TRUNCATE ON password_reset_tickets
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();

-- ----------------------------------------------------------------------------
-- 2. 注销审计（不含任何个人信息：只有用户 id、学校、时间与处理的数量）
-- ----------------------------------------------------------------------------

CREATE TABLE account_deletions (
    user_id              uuid PRIMARY KEY REFERENCES users(id),
    school_id            text NOT NULL REFERENCES schools(id),
    products_taken_down  integer NOT NULL CHECK (products_taken_down >= 0),
    requests_closed      integer NOT NULL CHECK (requests_closed >= 0),
    memberships_ended    integer NOT NULL CHECK (memberships_ended >= 0),
    request_id           text NOT NULL,
    deleted_at           timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER account_deletions_append_only BEFORE UPDATE OR DELETE ON account_deletions
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER account_deletions_no_truncate BEFORE TRUNCATE ON account_deletions
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();

-- 已注销的账号不能再被授予后台权限
CREATE FUNCTION staff_members_not_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.active AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'deleted accounts cannot hold staff roles' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER staff_members_not_deleted BEFORE INSERT OR UPDATE ON staff_members
    FOR EACH ROW EXECUTE FUNCTION staff_members_not_deleted();

-- ----------------------------------------------------------------------------
-- 3. 微信登录
-- ----------------------------------------------------------------------------

-- 一个账号至多绑定一个微信身份；同一小程序的同一 openid 至多绑定一个账号
CREATE TABLE user_wechat_identities (
    user_id     uuid PRIMARY KEY REFERENCES users(id),
    app_id      text NOT NULL CHECK (char_length(app_id) BETWEEN 1 AND 64),
    openid      text NOT NULL CHECK (char_length(openid) BETWEEN 1 AND 128),
    unionid     text CHECK (unionid IS NULL OR char_length(unionid) BETWEEN 1 AND 128),
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (app_id, openid)
);

-- 尚未绑定的微信身份换来的短时绑定票据（只存哈希；10 分钟；只能用一次）
CREATE TABLE wechat_bind_tickets (
    id           uuid PRIMARY KEY,
    ticket_hash  text NOT NULL UNIQUE CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
    app_id       text NOT NULL,
    openid       text NOT NULL,
    unionid      text,
    expires_at   timestamptz NOT NULL,
    used_at      timestamptz,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX wechat_bind_tickets_expires ON wechat_bind_tickets (expires_at);
