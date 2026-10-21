package com.lulu.campusmarketbackend.school;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 启动时导入 SCHOOL_PACKS 启用的学校数据包（格式与流程见 docs/school-data.md）。
 *
 * <ul>
 *   <li>在所有单例创建完、Web 服务开始接请求之前执行（{@link SmartInitializingSingleton}），此时 Flyway 已迁移完毕；
 *       任何数据包不合法或与库中数据冲突都会让应用启动失败，消息写明文件与字段。</li>
 *   <li>全部数据包在<b>同一个事务</b>里导入，并先取事务级 advisory lock：多个实例同时启动时串行执行，
 *       后到的实例看到相同校验和后直接跳过。</li>
 *   <li>学校、校区、楼栋按 id upsert；该校此前存在、但这次数据包里没有的校区与楼栋改为 active=false，
 *       从不删除（商品、用户资料、需求订阅仍然引用它们）。</li>
 *   <li>每次导入在 school_pack_imports 记一行（校验和 + 摘要）；校验和与该校最近一次导入相同则什么也不做。</li>
 * </ul>
 */
@Component
public class SchoolPackImporter implements SmartInitializingSingleton {
    private static final Logger log = LoggerFactory.getLogger(SchoolPackImporter.class);
    /** pg_advisory_xact_lock 的键：ASCII "SCHOOLPK"，只用于学校数据包导入。 */
    static final long LOCK_KEY = 0x5343484F4F4C504BL;
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 一个数据包的导入结果；imported=false 表示校验和未变而跳过。 */
    public record Result(String schoolId, String source, String checksum, boolean imported, Map<String, Object> summary) {}

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final String packs;
    private final String packsDir;

    public SchoolPackImporter(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                              @Value("${campus-market.schools.packs:}") String packs,
                              @Value("${campus-market.schools.packs-dir:}") String packsDir) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(transactionManager);
        this.packs = packs;
        this.packsDir = packsDir;
    }

    @Override
    public void afterSingletonsInstantiated() {
        List<String> ids = SchoolPackLoader.parseIds(packs);
        if (ids.isEmpty()) {
            log.info("school packs: none enabled (SCHOOL_PACKS is empty)");
            return;
        }
        importPacks(SchoolPackLoader.load(ids, packsDir));
    }

    /** 重新读取配置的数据包并导入（启动时调用；测试用它模拟重启）。 */
    public List<Result> importConfigured() {
        return importPacks(SchoolPackLoader.load(SchoolPackLoader.parseIds(packs), packsDir));
    }

    public List<Result> importPacks(List<SchoolPack> packs) {
        if (packs.isEmpty()) return List.of();
        SchoolPackValidator.validateTogether(packs);
        List<Result> results = tx.execute(status -> {
            jdbc.query("SELECT pg_advisory_xact_lock(?)", (ResultSetExtractor<Void>) rs -> null, LOCK_KEY);
            List<Result> out = new ArrayList<>();
            for (SchoolPack pack : packs) out.add(importOne(pack));
            return out;
        });
        for (Result r : Objects.requireNonNull(results)) {
            if (r.imported()) log.info("school pack {} imported from {}: {}", r.schoolId(), r.source(), r.summary());
            else log.info("school pack {} unchanged (checksum {}), skipped", r.schoolId(), r.checksum());
        }
        return results;
    }

    private Result importOne(SchoolPack pack) {
        String last = jdbc.query("SELECT checksum FROM school_pack_imports WHERE school_id = ? ORDER BY id DESC LIMIT 1",
                rs -> rs.next() ? rs.getString(1) : null, pack.id());
        if (pack.checksum().equals(last)) return new Result(pack.id(), pack.source(), pack.checksum(), false, Map.of());

        checkCollisions(pack);
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("source", pack.source());
        summary.put("coordinateSystem", pack.coordinateSystem());
        summary.put("school", upsertSchool(pack));
        summary.put("campuses", upsertCampuses(pack));
        summary.put("buildings", upsertBuildings(pack));
        summary.put("buildingsWithCoordinates", pack.campuses().stream()
                .flatMap(c -> c.buildings().stream()).filter(b -> b.latitude() != null).count());
        String json;
        try {
            json = JSON.writeValueAsString(summary);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        jdbc.update("INSERT INTO school_pack_imports(school_id, checksum, summary) VALUES (?, ?, ?::jsonb)",
                pack.id(), pack.checksum(), json);
        return new Result(pack.id(), pack.source(), pack.checksum(), true, summary);
    }

    /** 校区 id、楼栋 id 不能已被其他学校占用；楼栋也不能换到同校的另一个校区（复合外键依赖 (楼栋, 校区) 不变）。 */
    private void checkCollisions(SchoolPack pack) {
        Map<String, String> campusPath = new HashMap<>(), buildingPath = new HashMap<>(), buildingCampus = new HashMap<>();
        for (int i = 0; i < pack.campuses().size(); i++) {
            SchoolPack.Campus c = pack.campuses().get(i);
            campusPath.put(c.id(), "campuses[" + i + "].id");
            for (int j = 0; j < c.buildings().size(); j++) {
                buildingPath.put(c.buildings().get(j).id(), "campuses[" + i + "].buildings[" + j + "].id");
                buildingCampus.put(c.buildings().get(j).id(), c.id());
            }
        }
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT id, school_id FROM campuses WHERE id = ANY(?) AND school_id <> ? ORDER BY id",
                campusPath.keySet().toArray(String[]::new), pack.id())) {
            String id = String.valueOf(row.get("id"));
            throw SchoolPackException.at(pack.source(), campusPath.get(id),
                    "校区 id '" + id + "' 已属于学校 '" + row.get("school_id") + "'，不能被 '" + pack.id() + "' 使用");
        }
        if (buildingPath.isEmpty()) return;
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT b.id, b.campus_id, c.school_id FROM buildings b JOIN campuses c ON c.id = b.campus_id "
                        + "WHERE b.id = ANY(?) ORDER BY b.id", (Object) buildingPath.keySet().toArray(String[]::new))) {
            String id = String.valueOf(row.get("id"));
            String school = String.valueOf(row.get("school_id")), campus = String.valueOf(row.get("campus_id"));
            if (!school.equals(pack.id())) {
                throw SchoolPackException.at(pack.source(), buildingPath.get(id),
                        "楼栋 id '" + id + "' 已属于学校 '" + school + "'，不能被 '" + pack.id() + "' 使用");
            }
            if (!campus.equals(buildingCampus.get(id))) {
                throw SchoolPackException.at(pack.source(), buildingPath.get(id),
                        "楼栋 '" + id + "' 已登记在校区 '" + campus + "'，不能改到 '" + buildingCampus.get(id)
                                + "'；搬到新位置的楼栋请使用新的 id（旧 id 从数据包删除后会自动停用）");
            }
        }
    }

    private String upsertSchool(SchoolPack pack) {
        List<Map<String, Object>> before = jdbc.queryForList(
                "SELECT name, short_name, active, sort_order FROM schools WHERE id = ? FOR UPDATE", pack.id());
        jdbc.update("""
                INSERT INTO schools(id, name, short_name, active, sort_order) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name,
                    active = EXCLUDED.active, sort_order = EXCLUDED.sort_order
                """, pack.id(), pack.name(), pack.shortName(), pack.active(), pack.sortOrder());
        if (before.isEmpty()) return "inserted";
        Map<String, Object> old = before.get(0);
        boolean same = Objects.equals(old.get("name"), pack.name()) && Objects.equals(old.get("short_name"), pack.shortName())
                && Objects.equals(old.get("active"), pack.active()) && Objects.equals(old.get("sort_order"), pack.sortOrder());
        return same ? "unchanged" : "updated";
    }

    private Map<String, Object> upsertCampuses(SchoolPack pack) {
        Map<String, Map<String, Object>> before = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT id, name, active, sort_order FROM campuses WHERE school_id = ? FOR UPDATE", pack.id())) {
            before.put(String.valueOf(row.get("id")), row);
        }
        Counts counts = new Counts();
        for (SchoolPack.Campus c : pack.campuses()) {
            Map<String, Object> old = before.get(c.id());
            if (old == null) counts.inserted++;
            else if (Objects.equals(old.get("name"), c.name()) && Boolean.TRUE.equals(old.get("active"))
                    && Objects.equals(old.get("sort_order"), c.sortOrder())) counts.unchanged++;
            else counts.updated++;
        }
        jdbc.batchUpdate("""
                INSERT INTO campuses(id, school_id, name, active, sort_order) VALUES (?, ?, ?, true, ?)
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = true, sort_order = EXCLUDED.sort_order
                """, pack.campuses().stream().map(c -> new Object[]{c.id(), pack.id(), c.name(), c.sortOrder()}).toList());
        counts.deactivated = jdbc.update("UPDATE campuses SET active = false WHERE school_id = ? AND active AND NOT (id = ANY(?))",
                pack.id(), pack.campuses().stream().map(SchoolPack.Campus::id).toArray(String[]::new));
        return counts.toMap();
    }

    private Map<String, Object> upsertBuildings(SchoolPack pack) {
        Map<String, Map<String, Object>> before = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT b.id, b.campus_id, b.zone, b.name, b.latitude, b.longitude, b.active, b.sort_order
                FROM buildings b JOIN campuses c ON c.id = b.campus_id WHERE c.school_id = ? FOR UPDATE OF b
                """, pack.id())) {
            before.put(String.valueOf(row.get("id")), row);
        }
        record Row(String campus, SchoolPack.Building b) {}
        List<Row> rows = new ArrayList<>();
        for (SchoolPack.Campus c : pack.campuses()) for (SchoolPack.Building b : c.buildings()) rows.add(new Row(c.id(), b));

        Counts counts = new Counts();
        java.util.Set<String> kept = new java.util.HashSet<>();
        for (Row r : rows) {
            kept.add(r.b().id());
            Map<String, Object> old = before.get(r.b().id());
            if (old == null) counts.inserted++;
            else if (Boolean.TRUE.equals(old.get("active")) && Objects.equals(old.get("zone"), r.b().zone())
                    && Objects.equals(old.get("name"), r.b().name()) && Objects.equals(old.get("latitude"), r.b().latitude())
                    && Objects.equals(old.get("longitude"), r.b().longitude()) && Objects.equals(old.get("sort_order"), r.b().sortOrder())) {
                counts.unchanged++;
            } else counts.updated++;
        }
        for (Map.Entry<String, Map<String, Object>> e : before.entrySet()) {
            if (!kept.contains(e.getKey()) && Boolean.TRUE.equals(e.getValue().get("active"))) counts.deactivated++;
        }
        // 先把该校在用楼栋全部停用，再逐条 upsert 为在用：「同校区在用楼栋名唯一」在中间状态也不会冲突
        // （例如两栋楼互换名字、或新楼栋沿用了已删除楼栋的名字）。
        jdbc.update("UPDATE buildings b SET active = false FROM campuses c WHERE c.id = b.campus_id AND c.school_id = ? AND b.active", pack.id());
        if (!rows.isEmpty()) {
            jdbc.batchUpdate("""
                    INSERT INTO buildings(id, campus_id, zone, name, latitude, longitude, active, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, true, ?)
                    ON CONFLICT (id) DO UPDATE SET zone = EXCLUDED.zone, name = EXCLUDED.name, latitude = EXCLUDED.latitude,
                        longitude = EXCLUDED.longitude, active = true, sort_order = EXCLUDED.sort_order
                    """, new BatchPreparedStatementSetter() {
                @Override
                public void setValues(PreparedStatement ps, int i) throws SQLException {
                    Row r = rows.get(i);
                    ps.setString(1, r.b().id());
                    ps.setString(2, r.campus());
                    ps.setString(3, r.b().zone());
                    ps.setString(4, r.b().name());
                    ps.setObject(5, r.b().latitude(), Types.DOUBLE);
                    ps.setObject(6, r.b().longitude(), Types.DOUBLE);
                    ps.setInt(7, r.b().sortOrder());
                }

                @Override
                public int getBatchSize() {
                    return rows.size();
                }
            });
        }
        return counts.toMap();
    }

    private static final class Counts {
        int inserted, updated, unchanged, deactivated;

        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("inserted", inserted);
            m.put("updated", updated);
            m.put("unchanged", unchanged);
            m.put("deactivated", deactivated);
            return m;
        }
    }
}
