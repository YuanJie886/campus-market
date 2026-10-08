package com.lulu.campusmarketbackend.textbook;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.JsonFieldPolicy;
import com.lulu.campusmarketbackend.demand.DemandText;
import com.lulu.campusmarketbackend.mapper.CatalogMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.ratelimit.RateLimitService;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 教材建议（4.4）。
 *
 * <p>项目没有管理员与审核后台，因此建议<b>只能</b>是 PENDING（或本人撤回后的 WITHDRAWN）：
 * 不存在任何能把建议变成公开数据的路径，不展示「审核进度」，也没有「N 人认证即通过」。
 * 建议只有提交人本人能看到；公开课程页、教材页、商品页都不读这张表。
 */
@Service
public class TextbookSuggestionService {

    private static final Set<String> FIELDS = Set.of(
            "courseOfferingId", "textbookEditionId", "isbn", "title", "authors", "publisher",
            "editionLabel", "publishedYear", "usageType", "note");
    private static final Set<String> USAGE = Set.of("REQUIRED", "RECOMMENDED", "REFERENCE");

    private final CatalogMapper catalog;
    private final CatalogService catalogService;
    private final UserMapper users;
    private final RateLimitService rateLimit;

    public TextbookSuggestionService(CatalogMapper catalog, CatalogService catalogService, UserMapper users,
                                     RateLimitService rateLimit) {
        this.catalog = catalog;
        this.catalogService = catalogService;
        this.users = users;
        this.rateLimit = rateLimit;
    }

    /**
     * 提交建议。同一用户的相同建议（待审核中）幂等返回原记录，不重复计入每日限额；
     * 只有真正新建时才消耗「每日建议数」配额（复用 rate_limit_counters，按用户计）。
     */
    @Transactional
    public Map<String, Object> create(String uid, Map<String, Object> body) {
        JsonFieldPolicy.rejectUnknown(body, FIELDS);
        UUID userId = UUID.fromString(uid);
        String school = catalogService.schoolOf(uid);

        String offeringId = requiredText(body, "courseOfferingId", 64);
        if (catalog.selectOffering(offeringId, school) == null) throw ApiException.notFound("开课不存在");
        String usage = body.get("usageType") == null ? "REQUIRED" : String.valueOf(body.get("usageType"));
        if (!USAGE.contains(usage)) throw ApiException.badRequest("用途无效");
        String note = optionalText(body, "note", 200);

        String editionId = optionalText(body, "textbookEditionId", 64);
        String isbn13 = null, title = null, authors = null, publisher = null, editionLabel = null;
        Integer year = null;
        if (editionId != null) {
            if (body.get("isbn") != null || body.get("title") != null || body.get("authors") != null
                    || body.get("publisher") != null || body.get("editionLabel") != null || body.get("publishedYear") != null) {
                throw ApiException.badRequest("选择了目录中的教材版本时，不需要再填写书目信息");
            }
            catalogService.requireEdition(school, editionId);
        } else {
            String rawIsbn = optionalText(body, "isbn", 40);
            if (rawIsbn != null) {
                try {
                    isbn13 = Isbn.parse(rawIsbn).isbn13();
                } catch (Isbn.InvalidIsbnException e) {
                    throw ApiException.badRequest(e.getMessage());
                }
                // 目录里已经有这个 ISBN：直接指向该版本，避免同一本书出现两种建议
                Map<String, Object> existing = catalog.selectEditionByIsbn(isbn13, school);
                if (existing != null) {
                    editionId = DomainMapper.text(existing.get("id"));
                    isbn13 = null;
                }
            }
            if (editionId == null) {
                title = optionalText(body, "title", 120);
                authors = optionalText(body, "authors", 120);
                publisher = optionalText(body, "publisher", 80);
                editionLabel = optionalText(body, "editionLabel", 40);
                year = optionalYear(body.get("publishedYear"));
                if (isbn13 == null && title == null) throw ApiException.badRequest("请提供 ISBN 或书名");
                if (isbn13 == null && (publisher == null || editionLabel == null)) {
                    // 没有 ISBN 时版次与出版方是区分版本的唯一依据，不能省略
                    throw ApiException.badRequest("没有 ISBN 时，请同时填写出版社和版次");
                }
            } else if (body.get("title") != null || body.get("publisher") != null || body.get("editionLabel") != null
                    || body.get("authors") != null || body.get("publishedYear") != null) {
                throw ApiException.badRequest("该 ISBN 已在目录中，不需要再填写书目信息");
            }
        }

        String fingerprint = TextbookFingerprint.sha256(String.join("\n", "sg-v1",
                "offering=" + offeringId, "edition=" + nz(editionId), "isbn=" + nz(isbn13),
                "title=" + DemandText.normalize(nz(title)), "authors=" + DemandText.normalize(nz(authors)),
                "publisher=" + DemandText.normalize(nz(publisher)), "edition-label=" + DemandText.normalize(nz(editionLabel)),
                "year=" + (year == null ? "" : year), "usage=" + usage));

        users.lockById(userId);
        UUID existing = catalog.selectPendingSuggestion(userId, fingerprint);
        if (existing != null) return envelope(userId, existing, "EXISTING");

        rateLimit.consume(RateLimitService.Scope.TEXTBOOK_SUGGESTION, uid);
        UUID id = UUID.randomUUID();
        catalog.insertSuggestion(id, userId, school, offeringId, editionId, isbn13, title, authors, publisher,
                editionLabel, year, usage, note, fingerprint);
        return envelope(userId, id, "CREATED");
    }

    public List<Map<String, Object>> mine(String uid) {
        return catalog.selectSuggestionsBySubmitter(UUID.fromString(uid)).stream().map(TextbookSuggestionService::project).toList();
    }

    /** 撤回本人的待审核建议，幂等。他人的建议与不存在一样返回 404。 */
    @Transactional
    public Map<String, Object> withdraw(String uid, String id) {
        UUID userId = UUID.fromString(uid);
        UUID suggestionId;
        try {
            suggestionId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound("建议不存在");
        }
        String status = catalog.selectOwnSuggestionStatus(suggestionId, userId);
        if (status == null) throw ApiException.notFound("建议不存在");
        catalog.withdrawSuggestion(suggestionId, userId);
        return mine(uid).stream().filter(s -> id.equals(s.get("id"))).findFirst().orElseThrow();
    }

    private Map<String, Object> envelope(UUID userId, UUID id, String outcome) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("outcome", outcome);
        result.put("suggestion", mine(userId.toString()).stream()
                .filter(s -> id.toString().equals(s.get("id"))).findFirst().orElseThrow());
        return result;
    }

    /** 本人建议的投影：不含提交人、学校、指纹。状态只有 PENDING / WITHDRAWN。 */
    static Map<String, Object> project(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", DomainMapper.text(row.get("id")));
        result.put("courseOfferingId", DomainMapper.text(row.get("course_offering_id")));
        result.put("courseName", DomainMapper.text(row.get("course_name")));
        result.put("academicYear", DomainMapper.text(row.get("academic_year")));
        result.put("term", DomainMapper.text(row.get("term")));
        result.put("textbookEditionId", DomainMapper.nullableText(row.get("textbook_edition_id")));
        result.put("editionTitle", DomainMapper.nullableText(row.get("edition_title")));
        result.put("editionEditionLabel", DomainMapper.nullableText(row.get("edition_edition_label")));
        result.put("isbn", DomainMapper.nullableText(row.get("isbn13")));
        result.put("title", DomainMapper.nullableText(row.get("title")));
        result.put("authors", DomainMapper.nullableText(row.get("authors")));
        result.put("publisher", DomainMapper.nullableText(row.get("publisher")));
        result.put("editionLabel", DomainMapper.nullableText(row.get("edition_label")));
        result.put("publishedYear", row.get("published_year"));
        result.put("usageType", DomainMapper.text(row.get("usage_type")));
        result.put("note", DomainMapper.nullableText(row.get("note")));
        result.put("status", DomainMapper.text(row.get("status")));
        result.put("createdAt", DomainMapper.epoch(row.get("created_at")));
        return result;
    }

    private static String requiredText(Map<String, Object> body, String key, int max) {
        String value = optionalText(body, key, max);
        if (value == null) throw ApiException.badRequest("请提供 " + key);
        return value;
    }

    private static String optionalText(Map<String, Object> body, String key, int max) {
        Object raw = body.get(key);
        if (raw == null) return null;
        if (!(raw instanceof String text)) throw ApiException.badRequest(key + " 格式无效");
        String value = text.strip().replaceAll("(?U)\\s+", " ");
        if (value.isEmpty()) return null;
        if (value.length() > max) throw ApiException.badRequest(key + " 最多 " + max + " 个字");
        if (value.indexOf('<') >= 0 || value.indexOf('>') >= 0) throw ApiException.badRequest(key + " 不能包含尖括号");
        return value;
    }

    private static Integer optionalYear(Object raw) {
        if (raw == null) return null;
        if (!(raw instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())
                || n.intValue() < 1900 || n.intValue() > 2100) {
            throw ApiException.badRequest("出版年份无效");
        }
        return n.intValue();
    }

    private static String nz(String value) {
        return value == null ? "" : value;
    }
}
