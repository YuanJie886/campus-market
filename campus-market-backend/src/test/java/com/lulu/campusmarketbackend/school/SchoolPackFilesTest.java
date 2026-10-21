package com.lulu.campusmarketbackend.school;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 仓库里的每一个学校数据包（src/main/resources/schools/*.json）都必须通过校验，且彼此之间 id 不冲突。 */
class SchoolPackFilesTest {

    private static List<SchoolPack> allPacks() throws Exception {
        Resource[] files = new PathMatchingResourcePatternResolver().getResources("classpath*:schools/*.json");
        List<SchoolPack> packs = new ArrayList<>();
        for (Resource file : files) {
            String name = file.getFilename();
            assertThat(name).as("数据包文件名必须是 <学校 id>.json").matches("[a-z0-9][a-z0-9-]{1,62}\\.json");
            try (InputStream in = file.getInputStream()) {
                packs.add(SchoolPackValidator.parse(name, in.readAllBytes(), name.substring(0, name.length() - ".json".length())));
            }
        }
        return packs;
    }

    @Test
    @DisplayName("所有内置数据包都通过校验，并且可以同时启用（学校 / 校区 / 楼栋 id 全局唯一）")
    void everyBundledPackIsValid() throws Exception {
        List<SchoolPack> packs = allPacks();
        assertThat(packs).extracting(SchoolPack::id).contains("aust");
        SchoolPackValidator.validateTogether(packs);
    }

    @Test
    @DisplayName("安徽理工大学：淮南校区（1）、合肥校区（2），楼栋暂为空，notes 注明待学校核实")
    void austPack() throws Exception {
        SchoolPack aust = allPacks().stream().filter(p -> p.id().equals("aust")).findFirst().orElseThrow();
        assertThat(aust.name()).isEqualTo("安徽理工大学");
        assertThat(aust.shortName()).isEqualTo("安理工");
        assertThat(aust.coordinateSystem()).isEqualTo("GCJ-02");
        assertThat(aust.campuses()).extracting(SchoolPack.Campus::id, SchoolPack.Campus::name, SchoolPack.Campus::sortOrder)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("aust-huainan", "淮南校区", 1),
                        org.assertj.core.groups.Tuple.tuple("aust-hefei", "合肥校区", 2));
        assertThat(aust.buildingCount()).as("楼栋名称与坐标尚未取得，不得编造").isZero();
        assertThat(aust.notes()).contains("待学校核实");
    }
}
