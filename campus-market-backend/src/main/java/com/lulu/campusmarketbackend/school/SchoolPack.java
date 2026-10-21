package com.lulu.campusmarketbackend.school;

import java.util.List;

/**
 * 一个学校数据包（src/main/resources/schools/&lt;id&gt;.json 或 SCHOOL_PACKS_DIR 下的同名文件），
 * 已经通过 {@link SchoolPackValidator} 校验。格式见 docs/school-data.md。
 *
 * @param source   来源（文件路径或 classpath 位置），只用于报错与导入记录
 * @param checksum 文件内容的 SHA-256（小写十六进制）
 */
public record SchoolPack(String source, String checksum, String id, String name, String shortName,
                         String coordinateSystem, boolean active, int sortOrder, String notes,
                         List<Campus> campuses) {

    public record Campus(String id, String name, int sortOrder, List<Building> buildings) {}

    /** 坐标要么都有、要么都为 null（校验器保证）。 */
    public record Building(String id, String zone, String name, Double latitude, Double longitude, int sortOrder) {}

    public int buildingCount() {
        return campuses.stream().mapToInt(c -> c.buildings().size()).sum();
    }
}
