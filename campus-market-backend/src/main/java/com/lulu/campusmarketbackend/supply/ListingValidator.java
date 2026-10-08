package com.lulu.campusmarketbackend.supply;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.inspection.InspectionService;
import com.lulu.campusmarketbackend.mapper.BuildingMapper;
import com.lulu.campusmarketbackend.mapper.CatalogMapper;
import com.lulu.campusmarketbackend.mapper.SupplyMapper;
import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 发布前的逐项校验（5.2），返回稳定原因码：
 * VALID、MISSING_FIELD、INVALID_CATEGORY、INVALID_PRICE、INVALID_BUILDING、INVALID_INSPECTION、
 * INVALID_TEXTBOOK、INVALID_BUNDLE、INVALID_CIRCLE（模块 6：圈子可见范围或所有者的成员资格不满足），
 * 以及长度 / 成色 / 校区 / 图片等其他格式问题 INVALID_FIELD。
 *
 * <p>规则与商品发布（MarketService.createProductAs）一致；发布时商品写入还会再做一次完整校验，
 * 这里只是让用户在发布前逐条看到问题。参考数据（楼栋、校区、验货模板、教材版本）
 * 对整个批次一次性预读，读取语句数与条目数无关。
 */
@Component
public class ListingValidator {

    private static final List<String> REQUIRED = List.of("title", "description", "price", "category", "condition", "campus", "images");

    private final BuildingMapper buildings;
    private final CatalogMapper catalog;
    private final SupplyMapper supply;
    private final InspectionService inspections;
    private final BundleService bundles;
    private final com.lulu.campusmarketbackend.circle.ProductVisibility visibility;
    private final com.lulu.campusmarketbackend.school.SchoolScope schools;

    public ListingValidator(BuildingMapper buildings, CatalogMapper catalog, SupplyMapper supply,
                            InspectionService inspections, BundleService bundles,
                            com.lulu.campusmarketbackend.circle.ProductVisibility visibility,
                            com.lulu.campusmarketbackend.school.SchoolScope schools) {
        this.visibility = visibility;
        this.schools = schools;
        this.buildings = buildings;
        this.catalog = catalog;
        this.supply = supply;
        this.inspections = inspections;
        this.bundles = bundles;
    }

    public record Result(String code, String field, String message) {
        static final Result VALID = new Result("VALID", null, null);
        public boolean valid() { return "VALID".equals(code); }
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", code);
            m.put("field", field);
            m.put("message", message);
            return m;
        }
    }

    /** 一次批量校验所需的参考数据。 */
    public final class Lookups {
        final Map<String, Map<String, Object>> buildingById = new HashMap<>();
        final Map<String, String> schoolByCampus = new HashMap<>();
        final Map<String, InspectionService.TemplateRef> templates;
        final Map<String, Map<String, Object>> editionById = new HashMap<>();
        /** 模块 6：所有者在各学校可用的圈子（一条语句预读；发布时 createProductAs 还会加锁复核） */
        final Map<String, java.util.Set<java.util.UUID>> usableCirclesBySchool = new HashMap<>();
        final java.util.UUID owner;
        /** 6.1A：草稿的校区必须属于所有者本人的学校 */
        final String ownerSchool;

        Lookups(java.util.UUID owner, List<Map<String, Object>> payloads) {
            this.owner = owner;
            this.ownerSchool = owner == null ? null : schools.schoolOf(owner.toString());
            for (Map<String, Object> b : buildings.selectAllBuildings()) buildingById.put(DomainMapper.text(b.get("id")), b);
            for (Map<String, Object> c : supply.selectCampusSchools()) schoolByCampus.put(DomainMapper.text(c.get("id")), DomainMapper.text(c.get("school_id")));
            templates = inspections.activeTemplatesByCategory();
            List<String> editionIds = payloads.stream().map(p -> p.get("textbookEditionId"))
                    .filter(v -> v instanceof String s && !s.isBlank()).map(String::valueOf).distinct().toList();
            // 教材目录按学校划分；这里按任意学校取回，逐条再核对学校
            for (String school : Set.copyOf(schoolByCampus.values())) {
                if (editionIds.isEmpty()) break;
                for (Map<String, Object> e : catalog.selectEditionsByIds(editionIds, school)) {
                    editionById.put(DomainMapper.text(e.get("id")), e);
                }
            }
        }
    }

    public Lookups lookups(java.util.UUID owner, List<Map<String, Object>> payloads) {
        return new Lookups(owner, payloads);
    }

    /** 可见范围：形状（PUBLIC / CIRCLE_ONLY、1～5 个圈子）与所有者本人在这些圈子的在籍身份。 */
    private Result circleProblem(Map<String, Object> payload, String campus, Lookups lookups) {
        if (payload.get("visibility") == null && payload.get("circleIds") == null) return null;
        com.lulu.campusmarketbackend.circle.ProductVisibility.Choice choice;
        try {
            choice = com.lulu.campusmarketbackend.circle.ProductVisibility.parse(payload.get("visibility"), payload.get("circleIds"));
        } catch (ApiException e) {
            return new Result("INVALID_CIRCLE", "circleIds", e.getMessage());
        }
        if (!choice.circleOnly()) return null;
        String school = lookups.schoolByCampus.get(campus);
        java.util.Set<java.util.UUID> usable = lookups.usableCirclesBySchool.computeIfAbsent(school,
                s -> new java.util.HashSet<>(visibility.usableCircleIds(lookups.owner, s)));
        if (!usable.containsAll(choice.circleIds())) {
            return new Result("INVALID_CIRCLE", "circleIds", "圈子不存在、已归档，或所有者不是这个圈子的成员");
        }
        return null;
    }

    public Result validate(Map<String, Object> payload, String draftType, Lookups lookups) {
        List<String> missing = new ArrayList<>();
        for (String key : REQUIRED) {
            Object v = payload.get(key);
            if (v == null || (v instanceof String s && s.isBlank()) || (v instanceof List<?> l && l.isEmpty())) missing.add(key);
        }
        if ("BUNDLE".equals(draftType) && (payload.get("bundleItems") == null)) missing.add("bundleItems");
        if (!missing.isEmpty()) return new Result("MISSING_FIELD", String.join(",", missing), "还有必填项没有填写");

        String category = String.valueOf(payload.get("category"));
        if (!MarketService.CATEGORIES.contains(category)) return new Result("INVALID_CATEGORY", "category", "分类无效");
        try {
            MarketService.price(payload.get("price"));
            if (payload.get("originalPrice") != null) MarketService.price(payload.get("originalPrice"));
        } catch (ApiException e) {
            return new Result("INVALID_PRICE", "price", e.getMessage());
        }
        String campus;
        try {
            AuthService.string(payload, "title", 1, 100);
            AuthService.string(payload, "description", 1, 4000);
            MarketService.enumValue(payload.get("condition"), MarketService.CONDITIONS, "成色");
            campus = payload.get("campus") == null ? "" : String.valueOf(payload.get("campus"));
            String campusSchool = lookups.schoolByCampus.get(campus);
            if (campusSchool == null || (lookups.ownerSchool != null && !campusSchool.equals(lookups.ownerSchool))) {
                throw ApiException.badRequest("校区无效");
            }
            MarketService.images(payload.get("images"));
            if (payload.get("contact") != null) AuthService.optional(payload, "contact", 100);
        } catch (ApiException e) {
            return new Result("INVALID_FIELD", null, e.getMessage());
        }
        Result circle = circleProblem(payload, campus, lookups);
        if (circle != null) return circle;
        Object building = payload.get("buildingId");
        if (building instanceof String id && !id.isBlank()) {
            Map<String, Object> row = lookups.buildingById.get(id);
            if (row == null || !Boolean.TRUE.equals(row.get("active")) || !campus.equals(DomainMapper.text(row.get("campus_id")))) {
                return new Result("INVALID_BUILDING", "buildingId", "取货楼栋不存在、已停用或不属于该校区");
            }
        }
        if ("BUNDLE".equals(draftType)) {
            if (payload.get("inspection") != null) return new Result("INVALID_INSPECTION", "inspection", "整套打包商品按每条明细验货，不需要商品级验货清单");
            if (payload.get("textbookEditionId") != null) return new Result("INVALID_TEXTBOOK", "textbookEditionId", "整套打包商品不能关联单一教材版本");
            try {
                bundles.parse(payload.get("bundleItems"));
            } catch (ApiException e) {
                return new Result("INVALID_BUNDLE", "bundleItems", e.getMessage());
            }
            return Result.VALID;
        }
        if (payload.get("bundleItems") != null) return new Result("INVALID_BUNDLE", "bundleItems", "只有整套打包商品可以有明细");
        try {
            inspections.parseDisclosure(lookups.templates.get(category), payload.get("inspection"));
        } catch (ApiException e) {
            return new Result("INVALID_INSPECTION", "inspection", e.getMessage());
        }
        Object edition = payload.get("textbookEditionId");
        if (edition instanceof String id && !id.isBlank()) {
            if (!MarketService.TEXTBOOK_CATEGORY.equals(category)) {
                return new Result("INVALID_TEXTBOOK", "textbookEditionId", "只有教材书籍分类可以关联教材版本");
            }
            Map<String, Object> row = lookups.editionById.get(id);
            if (row == null || !DomainMapper.text(row.get("school_id")).equals(lookups.schoolByCampus.get(campus))) {
                return new Result("INVALID_TEXTBOOK", "textbookEditionId", "教材版本不存在");
            }
        }
        return Result.VALID;
    }
}
