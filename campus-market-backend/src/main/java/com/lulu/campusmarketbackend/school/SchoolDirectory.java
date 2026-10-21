package com.lulu.campusmarketbackend.school;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 公开的学校 / 校区目录（GET /v1/schools）。客户端用它渲染注册与资料页的校区选择，不再硬编码校区名。
 *
 * <p>只列出在用学校里的在用校区；演示学校在 DEMO_SCHOOL_ENABLED=false 时不出现。
 * 学校与校区都按 sort_order、名称（码点序，与部署环境的 locale 无关）、id 排序。
 * hasBuildings 表示该校区至少有一栋在用楼栋——没有楼栋数据时客户端隐藏楼栋选择与「只看本楼」。
 */
@Service
public class SchoolDirectory {
    private final JdbcTemplate jdbc;
    private final DemoSchool demo;

    public SchoolDirectory(JdbcTemplate jdbc, DemoSchool demo) {
        this.jdbc = jdbc;
        this.demo = demo;
    }

    public List<Map<String, Object>> list() {
        Map<String, Map<String, Object>> schools = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT id, name, short_name FROM schools WHERE active ORDER BY sort_order, name COLLATE \"C\", id COLLATE \"C\"")) {
            String id = String.valueOf(row.get("id"));
            if (!demo.visible(id)) continue;
            Map<String, Object> school = new LinkedHashMap<>();
            school.put("id", id);
            school.put("name", row.get("name"));
            school.put("shortName", row.get("short_name"));
            school.put("campuses", new ArrayList<Map<String, Object>>());
            schools.put(id, school);
        }
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT c.id, c.school_id, c.name,
                       EXISTS (SELECT 1 FROM buildings b WHERE b.campus_id = c.id AND b.active) AS has_buildings
                FROM campuses c WHERE c.active
                ORDER BY c.sort_order, c.name COLLATE "C", c.id COLLATE "C"
                """)) {
            Map<String, Object> school = schools.get(String.valueOf(row.get("school_id")));
            if (school == null) continue;
            Map<String, Object> campus = new LinkedHashMap<>();
            campus.put("id", row.get("id"));
            campus.put("name", row.get("name"));
            campus.put("hasBuildings", Boolean.TRUE.equals(row.get("has_buildings")));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> list = (List<Map<String, Object>>) school.get("campuses");
            list.add(campus);
        }
        return List.copyOf(schools.values());
    }
}
