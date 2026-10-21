package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import com.lulu.campusmarketbackend.mapper.ReferenceMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1")
public class CampusMarketController {
    private final AuthService auth;
    private final MarketService market;
    private final ProductMapper products;
    private final ReferenceMapper references;
    private final com.lulu.campusmarketbackend.demand.DemandSubscriptionService demandSubscriptions;
    private final com.lulu.campusmarketbackend.demand.DemandMatchService demandMatchService;
    private final com.lulu.campusmarketbackend.textbook.CatalogService catalog;
    private final com.lulu.campusmarketbackend.textbook.TextbookSuggestionService suggestions;

    public CampusMarketController(AuthService auth, MarketService market, ProductMapper products, ReferenceMapper references,
                                  com.lulu.campusmarketbackend.demand.DemandSubscriptionService demandSubscriptions,
                                  com.lulu.campusmarketbackend.demand.DemandMatchService demandMatchService,
                                  com.lulu.campusmarketbackend.textbook.CatalogService catalog,
                                  com.lulu.campusmarketbackend.textbook.TextbookSuggestionService suggestions) {
        this.auth = auth; this.market = market; this.products = products; this.references = references;
        this.demandSubscriptions = demandSubscriptions; this.demandMatchService = demandMatchService;
        this.catalog = catalog; this.suggestions = suggestions;
    }

    @GetMapping("/health")
    public Map<String, String> health() { references.health(); return Map.of("status", "ok"); }

    @PostMapping("/auth/register")
    public Map<String, Object> register(@RequestBody Map<String, Object> body, HttpServletResponse response) { return auth.register(body, response); }
    @PostMapping("/auth/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body, HttpServletResponse response) { return auth.login(body, response); }
    @PostMapping("/auth/refresh")
    public Map<String, Object> refresh(HttpServletRequest request, HttpServletResponse response) { return auth.refresh(request, response); }
    @PostMapping("/auth/logout")
    public Map<String, Object> logout(HttpServletRequest request, HttpServletResponse response) { auth.logout(request, response); return Map.of(); }
    @GetMapping("/auth/me")
    public Map<String, Object> me(HttpServletRequest request) { return market.user(auth.authenticate(request, false), true); }
    @PatchMapping("/auth/me")
    public Map<String, Object> profile(HttpServletRequest request, @RequestBody Map<String, Object> body) { return market.profile(auth.authenticate(request, false), body); }

    /** 6.1A：他人公开资料需要登录，只对同校用户可见；他校与不存在同为 404。 */
    @GetMapping("/users/{id}")
    public Map<String, Object> user(@PathVariable String id, HttpServletRequest request) { return market.publicUser(auth.authenticate(request, false), id); }
    /** 楼栋参考数据。公共只读，未登录可访问；不返回任何住户信息。 */
    @GetMapping("/buildings")
    public List<Map<String, Object>> buildings(@RequestParam("campus") String campus,
                                               @RequestParam(value = "zone", required = false) String zone) {
        return market.buildings(campus, zone);
    }
    // ---------------- 需求雷达 ----------------
    // 全部需要登录；身份只取自认证，路径与请求体中的任何 userId 都不会被采信。

    @PostMapping("/demand-subscriptions")
    public Map<String, Object> createDemandSubscription(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return demandSubscriptions.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/demand-subscriptions")
    public List<Map<String, Object>> demandSubscriptions(HttpServletRequest request) {
        return demandSubscriptions.list(auth.authenticate(request, false));
    }
    @PatchMapping("/demand-subscriptions/{id}")
    public Map<String, Object> updateDemandSubscription(HttpServletRequest request, @PathVariable String id,
                                                        @RequestBody Map<String, Object> body) {
        return demandSubscriptions.update(auth.authenticate(request, false), id, body);
    }
    @DeleteMapping("/demand-subscriptions/{id}")
    public Map<String, Object> deleteDemandSubscription(HttpServletRequest request, @PathVariable String id) {
        return demandSubscriptions.deactivate(auth.authenticate(request, false), id);
    }
    @GetMapping("/demand-matches")
    public Map<String, Object> demandMatches(HttpServletRequest request,
                                             @RequestParam(value = "page", defaultValue = "1") int page,
                                             @RequestParam(value = "pageSize", defaultValue = "20") int pageSize) {
        if (page < 1 || page > 10000 || pageSize < 1 || pageSize > 100) {
            throw com.lulu.campusmarketbackend.api.ApiException.badRequest("分页参数无效");
        }
        return demandMatchService.inbox(auth.authenticate(request, false), page, pageSize);
    }
    @GetMapping("/demand-matches/unread-count")
    public Map<String, Object> demandUnread(HttpServletRequest request) {
        return demandMatchService.unreadCount(auth.authenticate(request, false));
    }
    @PostMapping("/demand-matches/{id}/read")
    public Map<String, Object> readDemandMatch(HttpServletRequest request, @PathVariable String id) {
        return demandMatchService.markRead(auth.authenticate(request, false), id);
    }
    @PostMapping("/demand-matches/{id}/dismiss")
    public Map<String, Object> dismissDemandMatch(HttpServletRequest request, @PathVariable String id) {
        return demandMatchService.dismiss(auth.authenticate(request, false), id);
    }

    /** 发布页读取某分类的当前验货模板。公共只读；不支持的分类返回 data=null。 */
    @GetMapping("/inspection-templates")
    public Map<String, Object> inspectionTemplate(@RequestParam("category") String category) {
        return market.inspectionTemplate(category);
    }

    // 6.1A：商品的一切读取都需要登录，学校由认证身份推导（未登录只能看落地页与登录注册）
    @GetMapping("/products")
    public Map<String, Object> products(@RequestParam Map<String, String> query, HttpServletRequest request) { return market.products(query, auth.authenticate(request, false)); }
    /** 楼栋集市 feed：带 scope 元数据与自动降级，旧的 /v1/products 保持原样不变。 */
    @GetMapping("/products/feed")
    public Map<String, Object> feed(@RequestParam Map<String, String> query, HttpServletRequest request) {
        return market.feed(query, auth.authenticate(request, false));
    }
    @GetMapping("/products/{id}")
    public Map<String, Object> product(@PathVariable String id, HttpServletRequest request) { return market.product(id, auth.authenticate(request, false)); }
    @PostMapping("/products")
    public Map<String, Object> createProduct(HttpServletRequest request, @RequestBody Map<String, Object> body) { return market.createProduct(auth.authenticate(request, false), body); }
    @PatchMapping("/products/{id}")
    public Map<String, Object> updateProduct(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.updateProduct(auth.authenticate(request, false), id, body, null); }
    @PostMapping("/products/{id}/status")
    public Map<String, Object> updateStatus(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.updateProduct(auth.authenticate(request, false), id, body, String.valueOf(body.get("status"))); }
    @PostMapping("/products/{id}/view")
    public Map<String, Object> view(@PathVariable String id, HttpServletRequest request) { market.product(id, auth.authenticate(request, false)); try { products.incrementViews(java.util.UUID.fromString(id)); } catch (IllegalArgumentException e) { throw ApiException.badRequest("ID 格式无效"); } return Map.of(); }
    @GetMapping("/favorites")
    public List<Map<String, Object>> favorites(HttpServletRequest request) { return market.favorites(auth.authenticate(request, false)); }
    @PutMapping("/products/{id}/favorite")
    public Map<String, Object> favorite(HttpServletRequest request, @PathVariable String id) { return market.favorite(auth.authenticate(request, false), id); }
    @DeleteMapping("/products/{id}/favorite")
    public Map<String, Object> unfavorite(HttpServletRequest request, @PathVariable String id) { return market.unfavorite(auth.authenticate(request, false), id); }

    // ---------------- 课程教材图谱（模块 4） ----------------
    // 全部需要登录：学校只由登录用户的校区推导，匿名请求没有「当前学校」。

    @GetMapping("/courses")
    public Map<String, Object> courses(HttpServletRequest request, @RequestParam Map<String, String> query) {
        return catalog.courses(auth.authenticate(request, false), query);
    }
    @GetMapping("/courses/{courseId}")
    public Map<String, Object> course(HttpServletRequest request, @PathVariable String courseId) {
        return catalog.course(auth.authenticate(request, false), courseId);
    }
    @GetMapping("/course-offerings/{offeringId}")
    public Map<String, Object> courseOffering(HttpServletRequest request, @PathVariable String offeringId) {
        return catalog.offering(auth.authenticate(request, false), offeringId);
    }
    @GetMapping("/textbooks/isbn/{isbn}")
    public Map<String, Object> textbookByIsbn(HttpServletRequest request, @PathVariable String isbn) {
        return catalog.textbookByIsbn(auth.authenticate(request, false), isbn);
    }
    @GetMapping("/textbooks/{textbookEditionId}")
    public Map<String, Object> textbook(HttpServletRequest request, @PathVariable String textbookEditionId,
                                        @RequestParam(required = false) String sort) {
        return catalog.textbook(auth.authenticate(request, false), textbookEditionId, sort);
    }
    @PostMapping("/textbook-suggestions")
    public Map<String, Object> createTextbookSuggestion(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return suggestions.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/textbook-suggestions/mine")
    public List<Map<String, Object>> myTextbookSuggestions(HttpServletRequest request) {
        return suggestions.mine(auth.authenticate(request, false));
    }
    @DeleteMapping("/textbook-suggestions/{id}")
    public Map<String, Object> withdrawTextbookSuggestion(HttpServletRequest request, @PathVariable String id) {
        return suggestions.withdraw(auth.authenticate(request, false), id);
    }

    @GetMapping("/products/{id}/comments")
    public List<Map<String, Object>> comments(@PathVariable String id, HttpServletRequest request) { return market.comments(id, auth.authenticate(request, false)); }
    @PostMapping("/products/{id}/comments")
    public Map<String, Object> comment(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.comment(auth.authenticate(request, false), id, body); }
    @GetMapping("/conversations")
    public List<Map<String, Object>> conversations(HttpServletRequest request) { return market.conversations(auth.authenticate(request, false)); }
    @PostMapping("/conversations")
    public Map<String, Object> conversation(HttpServletRequest request, @RequestBody Map<String, Object> body) { JsonFieldPolicy.rejectUnknown(body, com.lulu.campusmarketbackend.service.MarketService.CONVERSATION_FIELDS); return market.conversation(auth.authenticate(request, false), String.valueOf(body.get("productId"))); }
    @GetMapping("/conversations/{id}/messages")
    public List<Map<String, Object>> messages(HttpServletRequest request, @PathVariable String id) { return market.messages(auth.authenticate(request, false), id); }
    @PostMapping("/conversations/{id}/messages")
    public Map<String, Object> message(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.message(auth.authenticate(request, false), id, body); }
    @PostMapping("/conversations/{id}/read")
    public Map<String, Object> read(HttpServletRequest request, @PathVariable String id) { market.read(auth.authenticate(request, false), id); return Map.of(); }
    @GetMapping("/messages/unread")
    public Map<String, Object> unread(HttpServletRequest request) { return market.unread(auth.authenticate(request, false)); }
}
