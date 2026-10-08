package com.lulu.campusmarketbackend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 模块 5 集成测试共用的 HTTP 辅助：注册、草稿 / 批次 / 邀请调用与完整面交流程。 */
public final class SupplyApi {

    public record User(String id, String token) {}

    private final MockMvc mvc;
    private final ObjectMapper json;

    public SupplyApi(MockMvc mvc, ObjectMapper json) {
        this.mvc = mvc;
        this.json = json;
    }

    public User register() throws Exception {
        return register("东校区");
    }

    public User register(String campus) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "sp" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "供给");
        b.put("campus", campus);
        b.put("contact", "13800000000");
        MvcResult r = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
        assertThat(r.getResponse().getStatus()).as("注册失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode d = data(r);
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }

    // ---------------- 商品字段 ----------------

    /** 一件可以直接发布的单件商品（受支持分类附带完整验货声明）。 */
    public static Map<String, Object> single(String category, String title, int price) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", title);
        b.put("description", "毕业季供给测试");
        b.put("price", price);
        b.put("category", category);
        b.put("condition", "几乎全新");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        List<Map<String, Object>> inspection = InspectionFixtures.fullDisclosure(category);
        if (inspection != null) b.put("inspection", inspection);
        return b;
    }

    /** 整套打包：n 条明细，分类轮换。 */
    public static Map<String, Object> bundle(String title, int price, int n) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("listingKind", "BUNDLE");
        b.put("title", title);
        b.put("description", "整套打包测试");
        b.put("price", price);
        b.put("category", "其他");
        b.put("condition", "轻微使用痕迹");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        b.put("bundleItems", bundleItems(n));
        return b;
    }

    public static List<Map<String, Object>> bundleItems(int n) {
        String[] categories = {"生活用品", "教材书籍", "数码电子", "服饰鞋包", "运动户外", "其他"};
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", "明细" + (i + 1));
            item.put("category", categories[i % categories.length]);
            item.put("condition", "轻微使用痕迹");
            item.put("quantity", 1 + i % 3);
            item.put("note", "第 " + (i + 1) + " 件");
            items.add(item);
        }
        return items;
    }

    // ---------------- HTTP ----------------

    public MvcResult get(User who, String path) throws Exception {
        return perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path), who);
    }

    public MvcResult post(User who, String path, Object body) throws Exception {
        return perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
    }

    public MvcResult put(User who, String path, Object body) throws Exception {
        return perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(path)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
    }

    public MvcResult patch(User who, String path, Object body) throws Exception {
        return perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch(path)
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
    }

    public MvcResult delete(User who, String path) throws Exception {
        return perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(path), who);
    }

    public MvcResult perform(MockHttpServletRequestBuilder builder, User who) throws Exception {
        // who 为 null 表示未登录请求
        return mvc.perform(who == null ? builder : builder.header("Authorization", "Bearer " + who.token())).andReturn();
    }

    public JsonNode data(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString()).path("data");
    }

    public JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString());
    }

    public static int status(MvcResult r) {
        return r.getResponse().getStatus();
    }

    public JsonNode ok(MvcResult r) throws Exception {
        assertThat(status(r)).as("请求失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r);
    }

    // ---------------- 草稿 / 批次 ----------------

    public JsonNode createDraft(User who, String type, Map<String, Object> payload) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("draftType", type);
        b.put("payload", payload);
        return ok(post(who, "/v1/listing-drafts", b));
    }

    public MvcResult saveDraft(User who, String id, int version, Map<String, Object> payload, String status) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("expectedVersion", version);
        if (payload != null) b.put("payload", payload);
        if (status != null) b.put("status", status);
        return patch(who, "/v1/listing-drafts/" + id, b);
    }

    /** n 件可发布的单件草稿组成一个批次，返回批次 id。 */
    public String readyBatch(User owner, int n, String titlePrefix) throws Exception {
        List<String> ids = new ArrayList<>();
        String[] categories = {"数码电子", "生活用品", "教材书籍", "服饰鞋包", "运动户外", "其他"};
        for (int i = 0; i < n; i++) {
            ids.add(createDraft(owner, "SINGLE", single(categories[i % categories.length], titlePrefix + "-" + (i + 1), 10 + i)).path("id").asText());
        }
        return ok(post(owner, "/v1/listing-batches", Map.of("draftIds", ids))).path("id").asText();
    }

    public MvcResult publish(User owner, String batchId, String key) throws Exception {
        var builder = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/v1/listing-batches/" + batchId + "/publish");
        if (key != null) builder = builder.header("Idempotency-Key", key);
        return perform(builder, owner);
    }

    // ---------------- 圈子（模块 6） ----------------

    public String createCircle(User owner, String name, String visibility) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("type", "CLUB");
        b.put("name", name);
        b.put("description", "圈子测试");
        b.put("visibility", visibility);
        return ok(post(owner, "/v1/circles", b)).path("id").asText();
    }

    public String inviteToken(User manager, String circleId) throws Exception {
        return ok(post(manager, "/v1/circles/" + circleId + "/invites", Map.of())).path("token").asText();
    }

    /** 管理者发邀请、目标用户兑换，返回圈子 id（便于链式调用）。 */
    public String join(User manager, String circleId, User member) throws Exception {
        ok(post(member, "/v1/circle-invites/redeem", Map.of("token", inviteToken(manager, circleId))));
        return circleId;
    }

    /** 一件圈子可见的单件商品。 */
    public String circleProduct(User seller, String title, String... circleIds) throws Exception {
        Map<String, Object> b = single("生活用品", title, 30);
        b.put("visibility", "CIRCLE_ONLY");
        b.put("circleIds", List.of(circleIds));
        return ok(post(seller, "/v1/products", b)).path("id").asText();
    }

    // ---------------- 订单 ----------------

    public String order(User buyer, String productId) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        b.put("idempotencyKey", UUID.randomUUID().toString());
        return ok(post(buyer, "/v1/orders", b)).path("id").asText();
    }

    public MvcResult transition(User who, String orderId, String to) throws Exception {
        // 模块 7：卖家确认之后的取消必须带结构化原因（确认前也接受）
        return post(who, "/v1/orders/" + orderId + "/transitions",
                "CANCELLED".equals(to) ? Map.of("to", to, "reasonCode", "CHANGED_MIND") : Map.of("to", to));
    }

    public JsonNode flow(User who, String orderId) throws Exception {
        return ok(get(who, "/v1/orders/" + orderId + "/flow"));
    }

    /** 买家对订单验货清单的每一条提交同一个结果。 */
    public MvcResult submitAll(User buyer, String orderId, String result) throws Exception {
        List<Map<String, Object>> items = new ArrayList<>();
        for (JsonNode item : flow(buyer, orderId).path("inspection").path("items")) {
            items.add(Map.of("itemCode", item.path("code").asText(), "result", result));
        }
        return post(buyer, "/v1/orders/" + orderId + "/inspection/submit", Map.of("items", items));
    }

    public MvcResult submit(User buyer, String orderId, List<Map<String, Object>> items) throws Exception {
        return post(buyer, "/v1/orders/" + orderId + "/inspection/submit", Map.of("items", items));
    }

    /** 下单 → 接单 → 验货全部一致 → 买家确认 → 卖家输入确认码完成。 */
    public String complete(User seller, User buyer, String productId, java.util.function.Function<String, String> codeOf) throws Exception {
        String orderId = order(buyer, productId);
        ok(transition(seller, orderId, "PENDING_MEETING"));
        if (flow(buyer, orderId).path("inspection").path("items").size() > 0) ok(submitAll(buyer, orderId, "MATCH"));
        ok(transition(buyer, orderId, "BUYER_CONFIRMED"));
        ok(post(seller, "/v1/orders/" + orderId + "/transitions", Map.of("to", "COMPLETED", "confirmationCode", codeOf.apply(orderId))));
        return orderId;
    }
}
