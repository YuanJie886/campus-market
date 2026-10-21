package com.lulu.campusmarketbackend.admin;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 在一次性数据库验证 V13 对已有审计对象的兼容性，不连接开发数据库。 */
@Testcontainers
class AdminAuditMigrationIT {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine");

    private SimpleDriverDataSource dataSource() {
        SimpleDriverDataSource source = new SimpleDriverDataSource();
        source.setDriverClass(org.postgresql.Driver.class);
        source.setUrl(POSTGRES.getJdbcUrl());
        source.setUsername(POSTGRES.getUsername());
        source.setPassword(POSTGRES.getPassword());
        return source;
    }

    private Flyway flyway(SimpleDriverDataSource source, String schema, String target) {
        return Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration").target(target).cleanDisabled(true).load();
    }

    @Test
    void freshDatabaseCreatesAuditTableAndProtectsRecords() {
        verifyUpgrade(false);
    }

    @Test
    void existingAuditTableIndexesAndTriggerPreserveHistoryDuringUpgrade() {
        verifyUpgrade(true);
    }

    private void verifyUpgrade(boolean existingAudit) {
        SimpleDriverDataSource source = dataSource();
        String schema = "audit_" + UUID.randomUUID().toString().replace("-", "");
        flyway(source, schema, "12").migrate();
        // 独立 schema 让两个场景共享一次性容器而不互相影响。
        source.setUrl(POSTGRES.getJdbcUrl() + "&currentSchema=" + schema);
        JdbcTemplate jdbc = new JdbcTemplate(source);
        UUID actor = UUID.randomUUID(), target = UUID.randomUUID(), audit = UUID.randomUUID();
        for (UUID user : new UUID[]{actor, target}) {
            jdbc.update("INSERT INTO users(id,account,password_hash,nickname,campus) VALUES (?,?,?,'迁移测试','东校区')",
                    user, user.toString(), "migration-test-only");
        }
        Map<String, Object> original = null;
        if (existingAudit) {
            // 模拟旧开发库：表和保护函数/触发器已存在，包含旧名索引与当前同名索引。
            jdbc.execute("""
                    CREATE TABLE admin_staff_audit (
                        id uuid PRIMARY KEY, school_id text NOT NULL REFERENCES schools(id),
                        staff_user_id uuid NOT NULL REFERENCES users(id), target_user_id uuid NOT NULL REFERENCES users(id),
                        old_role text, new_role text NOT NULL, old_active boolean, new_active boolean NOT NULL,
                        note text NOT NULL, request_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
                    )
                    """);
            jdbc.execute("CREATE INDEX admin_staff_audit_school ON admin_staff_audit(school_id,created_at DESC,id)");
            jdbc.execute("CREATE INDEX admin_staff_audit_school_created ON admin_staff_audit(school_id,created_at DESC,id DESC)");
            jdbc.execute("CREATE INDEX admin_staff_audit_school_target ON admin_staff_audit(school_id,target_user_id)");
            jdbc.execute("""
                    CREATE FUNCTION admin_staff_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN RAISE EXCEPTION 'legacy immutable guard' USING ERRCODE='check_violation'; END $$
                    """);
            jdbc.execute("CREATE TRIGGER admin_staff_audit_immutable BEFORE UPDATE OR DELETE ON admin_staff_audit "
                    + "FOR EACH ROW EXECUTE FUNCTION admin_staff_audit_immutable()");
            insertAudit(jdbc, audit, actor, target);
            original = jdbc.queryForMap("SELECT * FROM admin_staff_audit WHERE id=?", audit);
        }

        Flyway upgrade = flyway(source, schema, "13");
        assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(1);
        upgrade.validate();
        assertThat(upgrade.migrate().migrationsExecuted).isZero();
        if (existingAudit) {
            assertThat(jdbc.queryForMap("SELECT * FROM admin_staff_audit WHERE id=?", audit)).isEqualTo(original);
        } else {
            insertAudit(jdbc, audit, actor, target);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM admin_staff_audit", Integer.class)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("UPDATE admin_staff_audit SET note='篡改' WHERE id=?", audit))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(() -> jdbc.update("DELETE FROM admin_staff_audit WHERE id=?", audit))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
    }

    private void insertAudit(JdbcTemplate jdbc, UUID audit, UUID actor, UUID target) {
        jdbc.update("""
                INSERT INTO admin_staff_audit(id,school_id,staff_user_id,target_user_id,new_role,new_active,note,request_id)
                VALUES (?,'pilot',?,?,'AUDITOR',true,'保留历史授权记录','migration-test')
                """, audit, actor, target);
    }
}
