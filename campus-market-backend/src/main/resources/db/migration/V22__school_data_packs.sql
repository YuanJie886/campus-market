-- =============================================================================
-- V22 · 学校数据包：真实学校 / 校区 / 楼栋可以在不改代码的情况下接入
--
-- 学校、校区、楼栋由启动时的数据包导入器（SchoolPackImporter）从 JSON 数据包写入，
-- 格式与流程见 docs/school-data.md。本迁移只补齐导入器需要的列与审计表：
--
--   1. schools 增加 short_name / active / sort_order；campuses 增加 active / sort_order。
--      数据包里去掉的校区与楼栋只停用（active=false），从不删除——商品、用户、需求订阅仍引用它们。
--   2. 楼栋名唯一性改为「同一校区内在用楼栋名唯一」：停用的旧楼栋保留原名，
--      新楼栋可以重新使用这个名字（例如楼栋换了 id 重新录入）。
--   3. school_pack_imports：每次导入一条记录（只增不改、禁止 TRUNCATE），校验和不变时跳过导入。
--
-- V1 的演示学校 'pilot' 不是数据包，不受导入器管理；是否对外展示由 DEMO_SCHOOL_ENABLED 控制。
-- 只新增，不修改 V1～V21。
-- =============================================================================

ALTER TABLE schools ADD COLUMN short_name text NULL;
ALTER TABLE schools ADD COLUMN active     boolean NOT NULL DEFAULT true;
ALTER TABLE schools ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE campuses ADD COLUMN active     boolean NOT NULL DEFAULT true;
ALTER TABLE campuses ADD COLUMN sort_order integer NOT NULL DEFAULT 0;

-- 「同一校区内楼栋名唯一」只约束在用楼栋（V3 的表级 UNIQUE (campus_id, name) 换成部分唯一索引）
ALTER TABLE buildings DROP CONSTRAINT buildings_campus_id_name_key;
CREATE UNIQUE INDEX buildings_active_campus_name ON buildings (campus_id, name) WHERE active;

-- 公开的学校列表按 sort_order、名称排序；数据量是个位数，不额外建索引。
CREATE INDEX campuses_school ON campuses (school_id);

CREATE TABLE school_pack_imports (
    id          bigserial PRIMARY KEY,
    school_id   text NOT NULL REFERENCES schools(id),
    -- 数据包文件内容的 SHA-256（小写十六进制）；与该校最近一次导入相同则跳过
    checksum    text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- 来源文件、坐标系与各类行数（新增 / 更新 / 停用 / 未变）
    summary     jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object')
);
CREATE INDEX school_pack_imports_school ON school_pack_imports (school_id, id DESC);

CREATE TRIGGER school_pack_imports_append_only BEFORE UPDATE OR DELETE ON school_pack_imports
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER school_pack_imports_no_truncate BEFORE TRUNCATE ON school_pack_imports
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();
