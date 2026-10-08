-- 社区版 react-admin 的后台适配层。没有预置管理员、账号或密码。
ALTER TABLE staff_members DROP CONSTRAINT staff_members_role_check;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_role_check
    CHECK (role IN ('MODERATOR','SENIOR_MODERATOR','SCHOOL_ADMIN','AUDITOR'));
