-- =============================================================================
-- V2 · 主体维度限流计数表
--
-- 用途：在不引入 Redis、不依赖单 JVM 内存计数器的前提下，为登录、注册、refresh
-- 与订单确认码提交提供多实例一致的固定窗口限流。计数由数据库原子 UPSERT 完成。
--
-- 这是基础设施表，不属于 14 张业务领域表。
--
-- 隐私边界：只存 subject_hash（SHA-256 摘要），绝不存原始账号、邮箱、手机号、
-- 密码、Token、refresh token、确认码、Cookie 或 Authorization 头。
--
-- ⚠️ 需要明确的是：普通 SHA-256 只是避免数据库里直接出现原值，
--    它**不等于**对低熵输入（如常见邮箱、手机号）提供不可逆匿名化——
--    掌握候选集的人可以穷举比对。若将来需要真正的抗关联性，
--    应改用带独立密钥的 HMAC 或加盐派生，并单独规划密钥管理。
-- =============================================================================

CREATE TABLE rate_limit_counters (
    -- 操作类型，例如 auth_login / auth_register / auth_refresh / order_confirmation_code
    scope         text NOT NULL,
    -- 限流主体的 SHA-256 摘要（十六进制），不可逆存储原值
    subject_hash  text NOT NULL,
    -- 固定窗口起点，由数据库按窗口长度对齐计算
    window_start  timestamptz NOT NULL,
    request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    -- 窗口结束后可被清理任务删除
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, subject_hash, window_start)
);

-- 清理任务按过期时间批量删除
CREATE INDEX rate_limit_counters_expires_at ON rate_limit_counters(expires_at);
