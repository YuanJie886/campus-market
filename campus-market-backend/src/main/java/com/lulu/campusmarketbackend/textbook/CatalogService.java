package com.lulu.campusmarketbackend.textbook;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.building.BuildingFeedService;
import com.lulu.campusmarketbackend.building.BuildingScope;
import com.lulu.campusmarketbackend.demand.DemandText;
import com.lulu.campusmarketbackend.mapper.CatalogMapper;
import com.lulu.campusmarketbackend.mapper.DemandMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;

import java.sql.Array;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 课程教材图谱的查询（4.3）。
 *
 * <p>学校隔离：学校只由登录用户的校区推导；每条 SQL 都带 school_id 条件，
 * 其他学校的课程、开课、教材 id 一律 404，不区分「不存在」与「不属于你的学校」，避免枚举。
 *
 * <p>隐私：这里返回的只有目录数据与在售商品（按非本人视角投影，不含卖家联系方式）。
 * 没有订阅人数、等待人数、建议人、购买者或任何宿舍楼归属信息。
 */
@Service
public class CatalogService {

    public static final Set<String> TERMS = Set.of("SPRING", "SUMMER", "AUTUMN", "WINTER");
    public static final int LISTING_PAGE_SIZE = 20;

    private final CatalogMapper catalog;
    private final DemandMapper demands;
    private final UserMapper users;
    private final BuildingFeedService feeds;

    public CatalogService(CatalogMapper catalog, DemandMapper demands, UserMapper users, BuildingFeedService feeds) {
        this.catalog = catalog;
        this.demands = demands;
        this.users = users;
        this.feeds = feeds;
    }

    /** 登录用户所在学校。 */
    public String schoolOf(String uid) {
        String school = demands.selectUserSchool(UUID.fromString(uid));
        if (school == null) throw ApiException.unauthorized("登录已失效，请重新登录");
        return school;
    }

    // ------------------------------------------------------------------
    // 课程
    // ------------------------------------------------------------------

    public Map<String, Object> courses(String uid, Map<String, String> query) {
        String school = schoolOf(uid);
        String rawQ = query.getOrDefault("q", "");
        if (rawQ.length() > 80) throw ApiException.badRequest("搜索词最多 80 个字");
        String q = DemandText.normalize(rawQ);
        if (q.isEmpty()) q = null;
        String codePrefix = q == null ? null : q.toUpperCase(java.util.Locale.ROOT).replace(" ", "");
        if (codePrefix != null && !codePrefix.matches("[A-Z0-9-]{1,20}")) codePrefix = null;
        String term = blankToNull(query.get("term"));
        if (term != null && !TERMS.contains(term)) throw ApiException.badRequest("学期无效");
        String year = blankToNull(query.get("academicYear"));
        if (year != null && !year.matches("[0-9]{4}-[0-9]{4}")) throw ApiException.badRequest("学年格式应为 2026-2027");
        String campus = blankToNull(query.get("campus"));
        int page = intParam(query.get("page"), 1, 1, 10_000, "page");
        int pageSize = intParam(query.get("pageSize"), 20, 1, 50, "pageSize");

        List<Map<String, Object>> rows = catalog.selectCourses(school, q, codePrefix, term, year, campus,
                pageSize, (page - 1) * pageSize);
        long total = catalog.countCourses(school, q, codePrefix, term, year, campus);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = course(row);
            item.put("offeringCount", number(row.get("offering_count")));
            item.put("textbookCount", number(row.get("textbook_count")));
            items.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total);
        result.put("page", page);
        result.put("pageSize", pageSize);
        return result;
    }

    /** 课程详情：开课 + 每个开课的已验证教材（含在售数量）。固定 3 条 SQL，与教材数量无关。 */
    public Map<String, Object> course(String uid, String courseId) {
        String school = schoolOf(uid);
        Map<String, Object> row = catalog.selectCourse(courseId, school);
        if (row == null) throw ApiException.notFound("课程不存在");
        Map<String, Object> result = course(row);
        Map<String, List<Map<String, Object>>> byOffering = new LinkedHashMap<>();
        for (Map<String, Object> tb : catalog.selectVerifiedTextbooks(courseId, null, viewer(uid))) {
            byOffering.computeIfAbsent(DomainMapper.text(tb.get("course_offering_id")), k -> new ArrayList<>())
                    .add(courseTextbook(tb));
        }
        List<Map<String, Object>> offerings = new ArrayList<>();
        for (Map<String, Object> o : catalog.selectOfferingsByCourse(courseId)) {
            Map<String, Object> offering = offering(o);
            offering.put("textbooks", byOffering.getOrDefault(DomainMapper.text(o.get("id")), List.of()));
            offerings.add(offering);
        }
        result.put("offerings", offerings);
        return result;
    }

    public Map<String, Object> offering(String uid, String offeringId) {
        String school = schoolOf(uid);
        Map<String, Object> row = catalog.selectOffering(offeringId, school);
        if (row == null) throw ApiException.notFound("开课不存在");
        Map<String, Object> result = offering(row);
        Map<String, Object> courseInfo = new LinkedHashMap<>();
        courseInfo.put("id", DomainMapper.text(row.get("course_id")));
        courseInfo.put("name", DomainMapper.text(row.get("course_name")));
        courseInfo.put("courseCode", DomainMapper.nullableText(row.get("course_code")));
        courseInfo.put("isDemo", Boolean.TRUE.equals(row.get("is_demo")));
        result.put("course", courseInfo);
        result.put("textbooks", catalog.selectVerifiedTextbooks(null, offeringId, viewer(uid)).stream().map(this::courseTextbook).toList());
        return result;
    }

    // ------------------------------------------------------------------
    // 教材版本
    // ------------------------------------------------------------------

    public Map<String, Object> textbook(String uid, String editionId, String sort) {
        String school = schoolOf(uid);
        Map<String, Object> row = catalog.selectEdition(editionId, school);
        if (row == null) throw ApiException.notFound("教材版本不存在");
        return textbookDetail(uid, school, row, sort);
    }

    public Map<String, Object> textbookByIsbn(String uid, String rawIsbn) {
        String school = schoolOf(uid);
        Isbn.Parsed parsed;
        try {
            parsed = Isbn.parse(rawIsbn);
        } catch (Isbn.InvalidIsbnException e) {
            throw ApiException.badRequest(e.getMessage());
        }
        Map<String, Object> row = catalog.selectEditionByIsbn(parsed.isbn13(), school);
        if (row == null) throw ApiException.notFound("本校教材目录中没有这个 ISBN");
        return edition(row, catalog.countOnSale(DomainMapper.text(row.get("id")), viewer(uid)));
    }

    /** 商品关联教材时使用：本校目录中的启用版本，查不到即 404（含跨学校 id）。 */
    public Map<String, Object> requireEdition(String school, String editionId) {
        Map<String, Object> row = catalog.selectEdition(editionId, school);
        if (row == null) throw ApiException.notFound("教材版本不存在");
        return row;
    }

    private Map<String, Object> textbookDetail(String uid, String school, Map<String, Object> row, String sort) {
        String editionId = DomainMapper.text(row.get("id"));
        Map<String, Object> result = edition(row, catalog.countOnSale(editionId, viewer(uid)));

        List<Map<String, Object>> courses = new ArrayList<>();
        for (Map<String, Object> c : catalog.selectEditionCourses(editionId, school)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("courseId", DomainMapper.text(c.get("course_id")));
            item.put("courseName", DomainMapper.text(c.get("course_name")));
            item.put("courseCode", DomainMapper.nullableText(c.get("course_code")));
            item.put("offeringId", DomainMapper.text(c.get("offering_id")));
            item.put("academicYear", DomainMapper.text(c.get("academic_year")));
            item.put("term", DomainMapper.text(c.get("term")));
            item.put("instructorName", DomainMapper.nullableText(c.get("instructor_name")));
            item.put("usageType", DomainMapper.text(c.get("usage_type")));
            courses.add(item);
        }
        result.put("courses", courses);

        // 在售商品：精确版本与其他版本分两次查询、分两个字段返回，从不混在一起排序
        String orderBy = resolveSort(uid, sort);
        result.put("listingSort", orderBy);
        result.put("listings", listings(uid, List.of(editionId), orderBy));

        String workKey = DomainMapper.nullableText(row.get("work_key"));
        List<Map<String, Object>> others = workKey == null ? List.of() : catalog.selectOtherEditions(school, workKey, editionId, viewer(uid));
        List<Map<String, Object>> otherEditions = new ArrayList<>();
        for (Map<String, Object> o : others) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", DomainMapper.text(o.get("id")));
            item.put("isbn", DomainMapper.nullableText(o.get("normalized_isbn")));
            item.put("title", DomainMapper.text(o.get("title")));
            item.put("editionLabel", DomainMapper.text(o.get("edition_label")));
            item.put("publisher", DomainMapper.text(o.get("publisher")));
            item.put("publishedYear", o.get("published_year"));
            item.put("onSaleCount", number(o.get("on_sale_count")));
            otherEditions.add(item);
        }
        result.put("otherEditions", otherEditions);
        result.put("otherEditionListings", otherEditions.isEmpty() ? List.of()
                : listings(uid, otherEditions.stream().map(o -> (String) o.get("id")).toList(), orderBy));
        return result;
    }

    /**
     * 排序：用户要最近且设置了可用的宿舍楼时按楼栋距离（与楼栋集市同一公式），否则按最新发布。
     * 没有宿舍楼时不报错、不猜楼栋，如实退回最新。
     */
    private String resolveSort(String uid, String sort) {
        if (sort != null && !sort.isBlank() && !"nearest".equals(sort) && !"latest".equals(sort)) {
            throw ApiException.badRequest("排序方式无效");
        }
        if ("latest".equals(sort)) return "latest";
        Map<String, Object> me = users.selectRowById(UUID.fromString(uid));
        String dorm = me == null ? null : DomainMapper.nullableText(me.get("dorm_building_id"));
        return dorm == null ? "latest" : "nearest";
    }

    private List<Object> listings(String uid, List<String> editionIds, String orderBy) {
        BuildingFeedService.FeedQuery query = new BuildingFeedService.FeedQuery(null, null, null, null, null,
                BuildingScope.SCHOOL, "nearest".equals(orderBy) ? "nearest" : "p.created_at DESC",
                1, LISTING_PAGE_SIZE, editionIds, true);
        Map<String, Object> page;
        try {
            page = feeds.feed(query, uid);
        } catch (ApiException e) {
            // 宿舍楼刚被停用等情况：退回最新排序，而不是让整个教材页失败
            if (!"nearest".equals(orderBy)) throw e;
            page = feeds.feed(new BuildingFeedService.FeedQuery(null, null, null, null, null,
                    BuildingScope.SCHOOL, "p.created_at DESC", 1, LISTING_PAGE_SIZE, editionIds, true), uid);
        }
        @SuppressWarnings("unchecked")
        List<Object> items = (List<Object>) page.get("items");
        return items;
    }

    // ------------------------------------------------------------------
    // 投影
    // ------------------------------------------------------------------

    private static Map<String, Object> course(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("courseCode", DomainMapper.nullableText(row.get("course_code")));
        result.put("name", DomainMapper.text(row.get("name")));
        result.put("department", DomainMapper.nullableText(row.get("department")));
        result.put("isDemo", Boolean.TRUE.equals(row.get("is_demo")));
        return result;
    }

    private static Map<String, Object> offering(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("courseId", DomainMapper.text(row.get("course_id")));
        result.put("academicYear", DomainMapper.text(row.get("academic_year")));
        result.put("term", DomainMapper.text(row.get("term")));
        result.put("instructorName", DomainMapper.nullableText(row.get("instructor_name")));
        result.put("campusId", DomainMapper.nullableText(row.get("campus_id")));
        return result;
    }

    private Map<String, Object> courseTextbook(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("usageType", DomainMapper.text(row.get("usage_type")));
        result.put("edition", edition(row, number(row.get("on_sale_count"))));
        return result;
    }

    /** 教材版本的公开投影。 */
    static Map<String, Object> edition(Map<String, Object> row, long onSaleCount) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("isbn", DomainMapper.nullableText(row.get("normalized_isbn")));
        result.put("isbn10", DomainMapper.nullableText(row.get("isbn10")));
        result.put("title", DomainMapper.text(row.get("title")));
        result.put("subtitle", DomainMapper.nullableText(row.get("subtitle")));
        result.put("authors", textArray(row.get("authors")));
        result.put("publisher", DomainMapper.text(row.get("publisher")));
        result.put("editionLabel", DomainMapper.text(row.get("edition_label")));
        result.put("publishedYear", row.get("published_year"));
        result.put("coverUrl", DomainMapper.nullableText(row.get("cover_url")));
        result.put("isDemo", Boolean.TRUE.equals(row.get("is_demo")));
        result.put("onSaleCount", onSaleCount);
        return result;
    }

    static List<String> textArray(Object raw) {
        try {
            if (raw instanceof Array array) return List.of((String[]) array.getArray());
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        if (raw instanceof String[] values) return List.of(values);
        return List.of();
    }

    private static long number(Object value) {
        return value instanceof Number n ? n.longValue() : 0L;
    }

    private static String blankToNull(String raw) {
        return raw == null || raw.isBlank() ? null : raw.trim();
    }

    private static int intParam(String raw, int fallback, int min, int max, String name) {
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int value = Integer.parseInt(raw.trim());
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) {
            throw ApiException.badRequest(name + " 无效");
        }
    }

    private static java.util.UUID viewer(String uid) {
        return uid == null ? null : java.util.UUID.fromString(uid);
    }
}
