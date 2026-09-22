package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.mapper.ProductMapper;
import com.lulu.campusmarketbackend.mapper.ReferenceMapper;
import com.lulu.campusmarketbackend.service.MarketService;
import com.lulu.campusmarketbackend.service.OrderService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1")
public class CampusMarketController {
    private final AuthService auth;
    private final MarketService market;
    private final OrderService orders;
    private final ProductMapper products;
    private final ReferenceMapper references;

    public CampusMarketController(AuthService auth, MarketService market, OrderService orders, ProductMapper products, ReferenceMapper references) {
        this.auth = auth; this.market = market; this.orders = orders; this.products = products; this.references = references;
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

    @GetMapping("/users/{id}")
    public Map<String, Object> user(@PathVariable String id) { return market.user(id, false); }
    @GetMapping("/meeting-points")
    public List<Map<String, Object>> meetingPoints() { return market.meetingPoints(); }
    @GetMapping("/products")
    public Map<String, Object> products(@RequestParam Map<String, String> query, HttpServletRequest request) { return market.products(query, auth.authenticate(request, true)); }
    @GetMapping("/products/{id}")
    public Map<String, Object> product(@PathVariable String id, HttpServletRequest request) { return market.product(id, auth.authenticate(request, true)); }
    @PostMapping("/products")
    public Map<String, Object> createProduct(HttpServletRequest request, @RequestBody Map<String, Object> body) { return market.createProduct(auth.authenticate(request, false), body); }
    @PatchMapping("/products/{id}")
    public Map<String, Object> updateProduct(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.updateProduct(auth.authenticate(request, false), id, body, null); }
    @PostMapping("/products/{id}/status")
    public Map<String, Object> updateStatus(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.updateProduct(auth.authenticate(request, false), id, body, String.valueOf(body.get("status"))); }
    @PostMapping("/products/{id}/view")
    public Map<String, Object> view(@PathVariable String id, HttpServletRequest request) { market.product(id, auth.authenticate(request, true)); try { products.incrementViews(java.util.UUID.fromString(id)); } catch (IllegalArgumentException e) { throw ApiException.badRequest("ID 格式无效"); } return Map.of(); }
    @GetMapping("/favorites")
    public List<Map<String, Object>> favorites(HttpServletRequest request) { return market.favorites(auth.authenticate(request, false)); }
    @PutMapping("/products/{id}/favorite")
    public Map<String, Object> favorite(HttpServletRequest request, @PathVariable String id) { return market.favorite(auth.authenticate(request, false), id); }

    @PostMapping("/orders")
    public Map<String, Object> createOrder(HttpServletRequest request, @RequestBody Map<String, Object> body, @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) { Map<String, Object> copy = new HashMap<>(body); if (!copy.containsKey("idempotencyKey") && idempotencyKey != null) copy.put("idempotencyKey", idempotencyKey); return orders.create(auth.authenticate(request, false), copy); }
    @GetMapping("/orders")
    public List<Map<String, Object>> listOrders(HttpServletRequest request, @RequestParam(defaultValue = "all") String role) { return orders.list(auth.authenticate(request, false), role); }
    @PostMapping("/orders/{id}/transitions")
    public Map<String, Object> transition(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return orders.transition(auth.authenticate(request, false), id, body); }
    @PostMapping("/orders/{id}/reviews")
    public Map<String, Object> review(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return orders.review(auth.authenticate(request, false), id, body); }

    @GetMapping("/products/{id}/comments")
    public List<Map<String, Object>> comments(@PathVariable String id, HttpServletRequest request) { return market.comments(id, auth.authenticate(request, true)); }
    @PostMapping("/products/{id}/comments")
    public Map<String, Object> comment(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.comment(auth.authenticate(request, false), id, body); }
    @GetMapping("/conversations")
    public List<Map<String, Object>> conversations(HttpServletRequest request) { return market.conversations(auth.authenticate(request, false)); }
    @PostMapping("/conversations")
    public Map<String, Object> conversation(HttpServletRequest request, @RequestBody Map<String, Object> body) { return market.conversation(auth.authenticate(request, false), String.valueOf(body.get("productId"))); }
    @GetMapping("/conversations/{id}/messages")
    public List<Map<String, Object>> messages(HttpServletRequest request, @PathVariable String id) { return market.messages(auth.authenticate(request, false), id); }
    @PostMapping("/conversations/{id}/messages")
    public Map<String, Object> message(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) { return market.message(auth.authenticate(request, false), id, body); }
    @PostMapping("/conversations/{id}/read")
    public Map<String, Object> read(HttpServletRequest request, @PathVariable String id) { market.read(auth.authenticate(request, false), id); return Map.of(); }
    @GetMapping("/messages/unread")
    public Map<String, Object> unread(HttpServletRequest request) { return market.unread(auth.authenticate(request, false)); }
}
