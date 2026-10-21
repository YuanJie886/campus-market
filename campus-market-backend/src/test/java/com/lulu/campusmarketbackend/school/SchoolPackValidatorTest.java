package com.lulu.campusmarketbackend.school;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 学校数据包校验器：每条规则一个用例，断言报错消息里带有文件名与字段路径。 */
class SchoolPackValidatorTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static ObjectNode valid() {
        ObjectNode root = JSON.createObjectNode();
        root.put("id", "demo-u");
        root.put("name", "示例大学");
        root.put("shortName", "示例");
        root.put("coordinateSystem", "GCJ-02");
        ArrayNode campuses = root.putArray("campuses");
        ObjectNode a = campuses.addObject();
        a.put("id", "demo-u-a");
        a.put("name", "甲校区");
        a.put("sortOrder", 1);
        ArrayNode buildings = a.putArray("buildings");
        ObjectNode b1 = buildings.addObject();
        b1.put("id", "demo-u-a-1");
        b1.put("zone", "北区");
        b1.put("name", "1号楼");
        b1.put("latitude", 32.6);
        b1.put("longitude", 116.9);
        b1.put("sortOrder", 1);
        ObjectNode b2 = buildings.addObject();
        b2.put("id", "demo-u-a-2");
        b2.put("zone", "北区");
        b2.put("name", "2号楼");
        ObjectNode b = campuses.addObject();
        b.put("id", "demo-u-b");
        b.put("name", "乙校区");
        b.putArray("buildings");
        return root;
    }

    private static SchoolPack parse(ObjectNode root) {
        return SchoolPackValidator.parse("demo-u.json", root.toString(), "demo-u");
    }

    private static void rejects(Consumer<ObjectNode> mutation, String... fragments) {
        ObjectNode root = valid();
        mutation.accept(root);
        assertThatThrownBy(() -> parse(root)).isInstanceOf(SchoolPackException.class)
                .hasMessageContaining("demo-u.json").hasMessageContainingAll(fragments);
    }

    private static ObjectNode campus(ObjectNode root, int i) {
        return (ObjectNode) root.withArray("campuses").get(i);
    }

    private static ObjectNode building(ObjectNode root, int c, int b) {
        return (ObjectNode) campus(root, c).withArray("buildings").get(b);
    }

    @Test
    @DisplayName("合法数据包：字段全部读出，名称去首尾空白，缺省 sortOrder=0、active=true、坐标可空，生成 SHA-256 校验和")
    void validPackParses() {
        ObjectNode root = valid();
        building(root, 0, 1).put("name", "  2号楼 ");
        SchoolPack pack = parse(root);
        assertThat(pack.id()).isEqualTo("demo-u");
        assertThat(pack.shortName()).isEqualTo("示例");
        assertThat(pack.active()).isTrue();
        assertThat(pack.sortOrder()).isZero();
        assertThat(pack.campuses()).extracting(SchoolPack.Campus::id).containsExactly("demo-u-a", "demo-u-b");
        assertThat(pack.campuses().get(1).sortOrder()).isZero();
        assertThat(pack.campuses().get(1).buildings()).isEmpty();
        SchoolPack.Building b2 = pack.campuses().get(0).buildings().get(1);
        assertThat(b2.name()).isEqualTo("2号楼");
        assertThat(b2.latitude()).isNull();
        assertThat(b2.longitude()).isNull();
        assertThat(pack.campuses().get(0).buildings().get(0).latitude()).isEqualTo(32.6);
        assertThat(pack.checksum()).matches("[0-9a-f]{64}");
        assertThat(pack.buildingCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("id 规则：学校 / 校区 / 楼栋 id 必须匹配 ^[a-z0-9][a-z0-9-]{1,62}$")
    void idsMustMatchPattern() {
        rejects(r -> r.put("id", "Demo"), "id", "不符合 id 规则");
        rejects(r -> campus(r, 0).put("id", "东校区"), "campuses[0].id", "不符合 id 规则");
        rejects(r -> building(r, 0, 0).put("id", "-x1"), "campuses[0].buildings[0].id", "不符合 id 规则");
        rejects(r -> building(r, 0, 0).put("id", "a"), "campuses[0].buildings[0].id");
        rejects(r -> building(r, 0, 0).put("id", "a" + "b".repeat(63)), "campuses[0].buildings[0].id");
        rejects(r -> campus(r, 0).remove("id"), "campuses[0].id", "必填");
    }

    @Test
    @DisplayName("'pilot' 是内置演示学校，不能作为数据包 id；文件名与 id 必须一致")
    void pilotReservedAndFileNameMustMatch() {
        ObjectNode root = valid();
        root.put("id", "pilot");
        assertThatThrownBy(() -> SchoolPackValidator.parse("pilot.json", root.toString(), "pilot"))
                .hasMessageContaining("内置演示学校");
        assertThatThrownBy(() -> SchoolPackValidator.parse("other.json", valid().toString(), "other"))
                .hasMessageContainingAll("other.json", "id", "不一致");
    }

    @Test
    @DisplayName("校区 id、楼栋 id 在数据包内唯一；校区名在学校内唯一；楼栋名在校区内唯一")
    void duplicatesWithinPack() {
        rejects(r -> campus(r, 1).put("id", "demo-u-a"), "campuses[1].id", "重复");
        rejects(r -> building(r, 0, 1).put("id", "demo-u-a-1"), "campuses[0].buildings[1].id", "重复");
        rejects(r -> campus(r, 1).put("name", "甲校区"), "campuses[1].name", "重复");
        rejects(r -> building(r, 0, 1).put("name", "1号楼"), "campuses[0].buildings[1].name", "重复");
        // 不同校区可以有同名楼栋
        ObjectNode ok = valid();
        ObjectNode other = campus(ok, 1).withArray("buildings").addObject();
        other.put("id", "demo-u-b-1");
        other.put("zone", "北区");
        other.put("name", "1号楼");
        assertThat(parse(ok).buildingCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("多个数据包之间：学校 id、校区 id、楼栋 id 全局唯一")
    void globalUniquenessAcrossPacks() {
        SchoolPack first = parse(valid());
        ObjectNode second = valid();
        second.put("id", "other-u");
        assertThatThrownBy(() -> SchoolPackValidator.validateTogether(List.of(first,
                SchoolPackValidator.parse("other-u.json", second.toString(), "other-u"))))
                .hasMessageContainingAll("other-u.json", "campuses[0].id", "demo-u-a", "已在 demo-u.json 中使用");

        campus(second, 0).put("id", "other-u-a");
        campus(second, 1).put("id", "other-u-b");
        assertThatThrownBy(() -> SchoolPackValidator.validateTogether(List.of(first,
                SchoolPackValidator.parse("other-u.json", second.toString(), "other-u"))))
                .hasMessageContainingAll("campuses[0].buildings[0].id", "demo-u-a-1", "已在 demo-u.json 中使用");

        assertThatThrownBy(() -> SchoolPackValidator.validateTogether(List.of(first, first)))
                .hasMessageContaining("学校 id 'demo-u'");
    }

    @Test
    @DisplayName("名称：非空白、不超过 40 个字符（学校名、简称、校区名、园区、楼栋名）")
    void namesNonBlankAndBounded() {
        String long41 = "长".repeat(41);
        rejects(r -> r.put("name", "  "), "name", "不能为空白");
        rejects(r -> r.put("name", long41), "name", "超过 40 个字符");
        rejects(r -> r.put("shortName", ""), "shortName", "不能为空白");
        rejects(r -> campus(r, 0).put("name", long41), "campuses[0].name", "超过 40");
        rejects(r -> building(r, 0, 0).put("zone", " "), "campuses[0].buildings[0].zone", "不能为空白");
        rejects(r -> building(r, 0, 0).put("name", long41), "campuses[0].buildings[0].name", "超过 40");
        rejects(r -> building(r, 0, 0).remove("name"), "campuses[0].buildings[0].name", "必填");
        rejects(r -> building(r, 0, 0).put("name", 3), "campuses[0].buildings[0].name", "必须是字符串");
        // 恰好 40 个字符可以；4 字节字符按 1 个字符计
        ObjectNode ok = valid();
        ok.put("name", "长".repeat(39) + "𠀀");
        assertThat(parse(ok).name()).hasSize(41); // 39 + 代理对
        ok.remove("shortName");
        assertThat(parse(ok).shortName()).isNull();
    }

    @Test
    @DisplayName("经纬度：同时填写或同时留空，且在中国范围内（纬度 3～54、经度 73～136），必须是数字")
    void coordinates() {
        rejects(r -> building(r, 0, 0).remove("longitude"), "campuses[0].buildings[0].longitude", "同时填写或同时留空");
        rejects(r -> building(r, 0, 1).put("latitude", 32.1), "campuses[0].buildings[1].longitude", "同时填写或同时留空");
        rejects(r -> building(r, 0, 0).put("latitude", 2.9), "campuses[0].buildings[0].latitude", "不在中国范围内");
        rejects(r -> building(r, 0, 0).put("latitude", 54.01), "campuses[0].buildings[0].latitude", "纬度 3～54");
        rejects(r -> building(r, 0, 0).put("longitude", 72.9), "campuses[0].buildings[0].longitude", "经度 73～136");
        rejects(r -> building(r, 0, 0).put("longitude", 136.5), "campuses[0].buildings[0].longitude", "不在中国范围内");
        rejects(r -> building(r, 0, 0).put("latitude", "32.6"), "campuses[0].buildings[0].latitude", "必须是数字");
        ObjectNode ok = valid();
        building(ok, 0, 0).put("latitude", 3).put("longitude", 136);
        assertThat(parse(ok).campuses().get(0).buildings().get(0).longitude()).isEqualTo(136.0);
    }

    @Test
    @DisplayName("坐标系：必填，只能是 GCJ-02 / WGS-84 / BD-09；同一学校只有一个值，楼栋不能单独声明坐标系")
    void coordinateSystem() {
        rejects(r -> r.remove("coordinateSystem"), "coordinateSystem", "必填");
        rejects(r -> r.put("coordinateSystem", "gcj02"), "coordinateSystem", "GCJ-02、WGS-84 或 BD-09");
        rejects(r -> building(r, 0, 0).put("coordinateSystem", "WGS-84"), "campuses[0].buildings[0].coordinateSystem", "不支持的字段");
        for (String cs : List.of("GCJ-02", "WGS-84", "BD-09")) {
            ObjectNode ok = valid();
            ok.put("coordinateSystem", cs);
            assertThat(parse(ok).coordinateSystem()).isEqualTo(cs);
        }
    }

    @Test
    @DisplayName("楼栋总数不超过 3000（3000 可以，3001 拒绝）")
    void buildingLimit() {
        ObjectNode ok = valid();
        fill(ok, 3000);
        assertThat(parse(ok).buildingCount()).isEqualTo(3000);
        ObjectNode tooMany = valid();
        fill(tooMany, 3001);
        assertThatThrownBy(() -> parse(tooMany)).hasMessageContainingAll("demo-u.json", "campuses[1].buildings", "超过 3000");
    }

    private static void fill(ObjectNode root, int total) {
        ArrayNode list = campus(root, 1).withArray("buildings");
        for (int i = 0; i < total - 2; i++) {
            ObjectNode b = list.addObject();
            b.put("id", "demo-u-b-" + i);
            b.put("zone", "南区");
            b.put("name", i + "号楼");
        }
    }

    @Test
    @DisplayName("结构：不认识的字段、重复的 JSON 键、负数 / 小数 sortOrder、空校区列表、缺少 buildings、非法 JSON 都拒绝")
    void structure() {
        rejects(r -> building(r, 0, 0).put("lat", 32.0), "campuses[0].buildings[0].lat", "不支持的字段");
        rejects(r -> r.put("website", "x"), "website", "不支持的字段");
        rejects(r -> building(r, 0, 0).put("sortOrder", -1), "campuses[0].buildings[0].sortOrder", "整数");
        rejects(r -> campus(r, 0).put("sortOrder", 1.5), "campuses[0].sortOrder", "整数");
        rejects(r -> r.putArray("campuses"), "campuses", "至少包含一个校区");
        rejects(r -> campus(r, 1).remove("buildings"), "campuses[1].buildings", "写 []");
        rejects(r -> r.put("active", "yes"), "active", "true 或 false");
        assertThatThrownBy(() -> SchoolPackValidator.parse("demo-u.json", "{\"id\":\"demo-u\",\"id\":\"x\"}", "demo-u"))
                .hasMessageContainingAll("demo-u.json", "不是合法的 JSON");
        assertThatThrownBy(() -> SchoolPackValidator.parse("demo-u.json", "{\n\"id\": \"demo-u\",\n", "demo-u"))
                .hasMessageContainingAll("demo-u.json", "不是合法的 JSON", "第 ");
        assertThatThrownBy(() -> SchoolPackValidator.parse("demo-u.json", "[]", "demo-u"))
                .hasMessageContaining("顶层必须是 JSON 对象");
    }

    @Test
    @DisplayName("加载：SCHOOL_PACKS 解析、外部目录优先于 classpath、找不到文件 / id 非法 / 目录不存在时报错")
    void loader(@TempDir Path dir) throws Exception {
        assertThat(SchoolPackLoader.parseIds(" aust , ,aust,demo-u ")).containsExactly("aust", "demo-u");
        assertThat(SchoolPackLoader.parseIds("")).isEmpty();
        assertThatThrownBy(() -> SchoolPackLoader.parseIds("AUST")).hasMessageContaining("'AUST'");

        Files.writeString(dir.resolve("demo-u.json"), valid().toString(), StandardCharsets.UTF_8);
        List<SchoolPack> packs = SchoolPackLoader.load(List.of("demo-u", "aust"), dir.toString());
        assertThat(packs.get(0).source()).isEqualTo(dir.resolve("demo-u.json").toString());
        assertThat(packs.get(1).source()).isEqualTo("classpath:schools/aust.json");

        ObjectNode override = (ObjectNode) JSON.readTree(new String(
                SchoolPackValidatorTest.class.getResourceAsStream("/schools/aust.json").readAllBytes(), StandardCharsets.UTF_8));
        override.put("shortName", "外部覆盖");
        Files.writeString(dir.resolve("aust.json"), override.toString(), StandardCharsets.UTF_8);
        assertThat(SchoolPackLoader.load(List.of("aust"), dir.toString()).get(0).shortName()).isEqualTo("外部覆盖");

        assertThatThrownBy(() -> SchoolPackLoader.load(List.of("missing-u"), dir.toString()))
                .hasMessageContainingAll("missing-u.json", "找不到");
        assertThatThrownBy(() -> SchoolPackLoader.load(List.of("aust"), dir.resolve("nope").toString()))
                .hasMessageContaining("SCHOOL_PACKS_DIR");
    }
}
