package com.lulu.campusmarketbackend.building;

import com.lulu.campusmarketbackend.api.ApiException;

import java.util.List;

/**
 * 楼栋集市的范围层级。
 *
 * <p>这是「只看本楼」自动降级顺序的<b>唯一</b>定义：后端查询、响应元数据、
 * 前端提示、Mock 适配层全部引用这一处。顺序一旦在两个地方各写一遍，
 * 就一定会在某次改动后出现「后端降到园区、前端说降到校区」的错位。
 */
public enum BuildingScope {
    /** 仅本楼栋 */
    BUILDING("本楼"),
    /** 同园区 */
    ZONE("本园区"),
    /** 同校区 */
    CAMPUS("本校区"),
    /** 全校 */
    SCHOOL("全校");

    private final String label;

    BuildingScope(String label) {
        this.label = label;
    }

    /** 给用户看的范围名称。仅用于展示，绝不参与任何业务判断。 */
    public String label() {
        return label;
    }

    /** 降级链：从本层级开始，逐级放宽到全校。 */
    public List<BuildingScope> fallbackChain() {
        return switch (this) {
            case BUILDING -> List.of(BUILDING, ZONE, CAMPUS, SCHOOL);
            case ZONE -> List.of(ZONE, CAMPUS, SCHOOL);
            case CAMPUS -> List.of(CAMPUS, SCHOOL);
            case SCHOOL -> List.of(SCHOOL);
        };
    }

    /**
     * 该范围是否允许自动降级。
     *
     * <p>只有用户<b>主动</b>开启「只看本楼」时才降级。普通浏览（CAMPUS/SCHOOL）
     * 结果为空就是空——擅自扩大用户明确选择的校区范围，会让人以为自己筛错了。
     */
    public boolean allowsFallback() {
        return this == BUILDING;
    }

    public static BuildingScope parse(String raw) {
        if (raw == null || raw.isBlank()) return SCHOOL;
        try {
            return valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("范围无效");
        }
    }
}
