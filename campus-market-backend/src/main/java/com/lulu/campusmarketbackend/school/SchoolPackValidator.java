package com.lulu.campusmarketbackend.school;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 学校数据包的格式校验。规则只在这里实现一次；scripts/school-pack-from-csv.mjs 按同一套规则做离线检查，
 * 两边的规则清单见 docs/school-data.md。任何一条不满足都抛出 {@link SchoolPackException}，消息写明来源文件与字段路径。
 *
 * <ul>
 *   <li>学校、校区、楼栋 id：{@code ^[a-z0-9][a-z0-9-]{1,62}$}；'pilot' 是 V1 演示学校，不能作为数据包 id；</li>
 *   <li>校区 id、楼栋 id 在数据包内（以及同时启用的所有数据包之间）唯一；</li>
 *   <li>名称（学校名、简称、校区名、园区、楼栋名）非空白且不超过 40 个字符；同一学校内校区名不重复，同一校区内楼栋名不重复；</li>
 *   <li>经纬度要么都填、要么都不填，且在中国范围内（纬度 3～54，经度 73～136）；</li>
 *   <li>coordinateSystem ∈ {GCJ-02, WGS-84, BD-09}，整个学校只有这一个值（楼栋不能各自声明坐标系）；</li>
 *   <li>楼栋总数不超过 3000；不认识的字段一律拒绝（例如把 latitude 写成 lat）。</li>
 * </ul>
 * 与数据库现有数据的冲突（id 已被其他学校占用等）由 {@link SchoolPackImporter} 在导入事务里检查。
 */
public final class SchoolPackValidator {

    public static final Pattern ID = Pattern.compile("^[a-z0-9][a-z0-9-]{1,62}$");
    public static final Set<String> COORDINATE_SYSTEMS = Set.of("GCJ-02", "WGS-84", "BD-09");
    public static final int MAX_NAME_LENGTH = 40;
    public static final int MAX_BUILDINGS = 3000;
    public static final int MAX_NOTES_LENGTH = 2000;
    public static final int MAX_SORT_ORDER = 1_000_000;
    public static final double MIN_LATITUDE = 3, MAX_LATITUDE = 54, MIN_LONGITUDE = 73, MAX_LONGITUDE = 136;

    private static final Set<String> SCHOOL_FIELDS = Set.of("id", "name", "shortName", "coordinateSystem", "active", "sortOrder", "notes", "campuses");
    private static final Set<String> CAMPUS_FIELDS = Set.of("id", "name", "sortOrder", "buildings");
    private static final Set<String> BUILDING_FIELDS = Set.of("id", "zone", "name", "latitude", "longitude", "sortOrder");

    private static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

    private SchoolPackValidator() {}

    /**
     * 解析并校验一个数据包。
     *
     * @param source     来源描述（文件名），只用于报错
     * @param content    文件内容（UTF-8）
     * @param expectedId 文件名 / SCHOOL_PACKS 里的 id；为 null 时不检查
     */
    public static SchoolPack parse(String source, byte[] content, String expectedId) {
        JsonNode root;
        try {
            root = JSON.readTree(content);
        } catch (JsonProcessingException e) {
            throw SchoolPackException.at(source, null, "不是合法的 JSON（" + e.getOriginalMessage() + "，第 "
                    + (e.getLocation() == null ? "?" : e.getLocation().getLineNr()) + " 行）");
        } catch (java.io.IOException e) {
            throw SchoolPackException.at(source, null, "无法读取：" + e.getMessage());
        }
        if (root == null || !root.isObject()) throw SchoolPackException.at(source, null, "顶层必须是 JSON 对象");
        Ctx ctx = new Ctx(source);
        ctx.onlyFields(root, "", SCHOOL_FIELDS);

        String id = ctx.id(root, "id");
        if (DemoSchool.ID.equals(id)) throw ctx.fail("id", "'pilot' 是内置演示学校，不能作为数据包 id");
        if (expectedId != null && !expectedId.equals(id)) {
            throw ctx.fail("id", "与文件名 / SCHOOL_PACKS 中的 '" + expectedId + "' 不一致（实际为 '" + id + "'）");
        }
        String name = ctx.name(root, "name", true);
        String shortName = ctx.name(root, "shortName", false);
        String coordinateSystem = ctx.text(root, "coordinateSystem", true);
        if (!COORDINATE_SYSTEMS.contains(coordinateSystem)) {
            throw ctx.fail("coordinateSystem", "必须是 GCJ-02、WGS-84 或 BD-09 之一（实际为 '" + coordinateSystem + "'）；同一学校只能使用一种坐标系");
        }
        boolean active = ctx.bool(root, "active", true);
        int sortOrder = ctx.sortOrder(root, "sortOrder");
        String notes = ctx.text(root, "notes", false);
        if (notes != null && notes.codePointCount(0, notes.length()) > MAX_NOTES_LENGTH) {
            throw ctx.fail("notes", "不能超过 " + MAX_NOTES_LENGTH + " 个字符");
        }

        JsonNode campusNodes = root.get("campuses");
        if (campusNodes == null || !campusNodes.isArray() || campusNodes.isEmpty()) {
            throw ctx.fail("campuses", "必须是至少包含一个校区的数组");
        }
        List<SchoolPack.Campus> campuses = new ArrayList<>();
        Map<String, String> campusIds = new HashMap<>(), campusNames = new HashMap<>(), buildingIds = new HashMap<>();
        int total = 0;
        for (int i = 0; i < campusNodes.size(); i++) {
            String path = "campuses[" + i + "]";
            JsonNode c = campusNodes.get(i);
            if (!c.isObject()) throw ctx.fail(path, "必须是对象");
            ctx.onlyFields(c, path + ".", CAMPUS_FIELDS);
            String campusId = ctx.id(c, path + ".id");
            String previous = campusIds.putIfAbsent(campusId, path);
            if (previous != null) throw ctx.fail(path + ".id", "校区 id '" + campusId + "' 与 " + previous + " 重复");
            String campusName = ctx.name(c, path + ".name", true);
            previous = campusNames.putIfAbsent(campusName, path);
            if (previous != null) throw ctx.fail(path + ".name", "校区名 '" + campusName + "' 与 " + previous + " 重复");
            int campusSort = ctx.sortOrder(c, path + ".sortOrder");

            JsonNode buildingNodes = c.get("buildings");
            if (buildingNodes == null || !buildingNodes.isArray()) {
                throw ctx.fail(path + ".buildings", "必须是数组（还没有楼栋数据时写 []）");
            }
            total += buildingNodes.size();
            if (total > MAX_BUILDINGS) throw ctx.fail(path + ".buildings", "楼栋总数超过 " + MAX_BUILDINGS + " 栋");
            List<SchoolPack.Building> buildings = new ArrayList<>();
            Map<String, String> buildingNames = new HashMap<>();
            for (int j = 0; j < buildingNodes.size(); j++) {
                String bpath = path + ".buildings[" + j + "]";
                JsonNode b = buildingNodes.get(j);
                if (!b.isObject()) throw ctx.fail(bpath, "必须是对象");
                ctx.onlyFields(b, bpath + ".", BUILDING_FIELDS);
                String buildingId = ctx.id(b, bpath + ".id");
                previous = buildingIds.putIfAbsent(buildingId, bpath);
                if (previous != null) throw ctx.fail(bpath + ".id", "楼栋 id '" + buildingId + "' 与 " + previous + " 重复");
                String zone = ctx.name(b, bpath + ".zone", true);
                String buildingName = ctx.name(b, bpath + ".name", true);
                previous = buildingNames.putIfAbsent(buildingName, bpath);
                if (previous != null) throw ctx.fail(bpath + ".name", "同一校区内楼栋名 '" + buildingName + "' 与 " + previous + " 重复");
                Double latitude = ctx.coordinate(b, bpath + ".latitude", MIN_LATITUDE, MAX_LATITUDE, "纬度");
                Double longitude = ctx.coordinate(b, bpath + ".longitude", MIN_LONGITUDE, MAX_LONGITUDE, "经度");
                if ((latitude == null) != (longitude == null)) {
                    throw ctx.fail(bpath + (latitude == null ? ".latitude" : ".longitude"), "经纬度必须同时填写或同时留空");
                }
                buildings.add(new SchoolPack.Building(buildingId, zone, buildingName, latitude, longitude, ctx.sortOrder(b, bpath + ".sortOrder")));
            }
            campuses.add(new SchoolPack.Campus(campusId, campusName, campusSort, List.copyOf(buildings)));
        }
        return new SchoolPack(source, sha256(content), id, name, shortName, coordinateSystem, active, sortOrder, notes, List.copyOf(campuses));
    }

    /** 同时启用的多个数据包：学校 id、校区 id、楼栋 id 在所有数据包之间全局唯一。 */
    public static void validateTogether(List<SchoolPack> packs) {
        Map<String, String> schools = new HashMap<>(), campuses = new HashMap<>(), buildings = new HashMap<>();
        for (SchoolPack pack : packs) {
            String other = schools.putIfAbsent(pack.id(), pack.source());
            if (other != null) throw SchoolPackException.at(pack.source(), "id", "学校 id '" + pack.id() + "' 与 " + other + " 重复");
            for (int i = 0; i < pack.campuses().size(); i++) {
                SchoolPack.Campus c = pack.campuses().get(i);
                other = campuses.putIfAbsent(c.id(), pack.source());
                if (other != null) throw SchoolPackException.at(pack.source(), "campuses[" + i + "].id", "校区 id '" + c.id() + "' 已在 " + other + " 中使用");
                for (int j = 0; j < c.buildings().size(); j++) {
                    SchoolPack.Building b = c.buildings().get(j);
                    other = buildings.putIfAbsent(b.id(), pack.source());
                    if (other != null) {
                        throw SchoolPackException.at(pack.source(), "campuses[" + i + "].buildings[" + j + "].id", "楼栋 id '" + b.id() + "' 已在 " + other + " 中使用");
                    }
                }
            }
        }
    }

    public static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 校验上下文：只携带来源，用于拼报错消息。 */
    private record Ctx(String source) {
        SchoolPackException fail(String field, String problem) {
            return SchoolPackException.at(source, field, problem);
        }

        void onlyFields(JsonNode node, String prefix, Set<String> allowed) {
            Set<String> unknown = new HashSet<>();
            for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
                String f = it.next();
                if (!allowed.contains(f)) unknown.add(f);
            }
            if (!unknown.isEmpty()) {
                String first = unknown.stream().sorted().findFirst().orElseThrow();
                throw fail(prefix + first, "不支持的字段（允许的字段：" + String.join("、", allowed.stream().sorted().toList()) + "）");
            }
        }

        String text(JsonNode node, String path, boolean required) {
            JsonNode v = node.get(leaf(path));
            if (v == null || v.isNull()) {
                if (required) throw fail(path, "必填");
                return null;
            }
            if (!v.isTextual()) throw fail(path, "必须是字符串");
            return v.asText();
        }

        String id(JsonNode node, String path) {
            String v = text(node, path, true);
            if (!ID.matcher(v).matches()) {
                throw fail(path, "'" + v + "' 不符合 id 规则：小写字母、数字、连字符，以字母或数字开头，2～63 个字符");
            }
            return v;
        }

        String name(JsonNode node, String path, boolean required) {
            String v = text(node, path, required);
            if (v == null) return null;
            String trimmed = v.strip();
            if (trimmed.isEmpty()) throw fail(path, "不能为空白");
            if (trimmed.codePointCount(0, trimmed.length()) > MAX_NAME_LENGTH) {
                throw fail(path, "'" + trimmed + "' 超过 " + MAX_NAME_LENGTH + " 个字符");
            }
            return trimmed;
        }

        boolean bool(JsonNode node, String path, boolean fallback) {
            JsonNode v = node.get(leaf(path));
            if (v == null || v.isNull()) return fallback;
            if (!v.isBoolean()) throw fail(path, "必须是 true 或 false");
            return v.booleanValue();
        }

        int sortOrder(JsonNode node, String path) {
            JsonNode v = node.get(leaf(path));
            if (v == null || v.isNull()) return 0;
            if (!v.isIntegralNumber() || !v.canConvertToInt() || v.intValue() < 0 || v.intValue() > MAX_SORT_ORDER) {
                throw fail(path, "必须是 0～" + MAX_SORT_ORDER + " 的整数");
            }
            return v.intValue();
        }

        Double coordinate(JsonNode node, String path, double min, double max, String label) {
            JsonNode v = node.get(leaf(path));
            if (v == null || v.isNull()) return null;
            if (!v.isNumber()) throw fail(path, label + "必须是数字（不要加引号）");
            double d = v.doubleValue();
            if (!Double.isFinite(d) || d < min || d > max) {
                throw fail(path, label + " " + v.asText() + " 不在中国范围内（" + label + " " + fmt(min) + "～" + fmt(max) + "）");
            }
            return d;
        }

        private static String fmt(double d) {
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }

        private static String leaf(String path) {
            int dot = path.lastIndexOf('.');
            return dot < 0 ? path : path.substring(dot + 1);
        }
    }

    /** 测试与工具使用：UTF-8 文本形式的入口。 */
    public static SchoolPack parse(String source, String content, String expectedId) {
        return parse(source, content.getBytes(StandardCharsets.UTF_8), expectedId);
    }
}
