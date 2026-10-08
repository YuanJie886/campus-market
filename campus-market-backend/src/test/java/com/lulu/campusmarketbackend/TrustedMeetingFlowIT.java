package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.service.OrderService;
import com.lulu.campusmarketbackend.support.InspectionFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * 可信面交闭环：订单快照、验货、档期握手、出发/已到、时间线与履历（模块 3.3～3.6）。
 * 全部在真实 PostgreSQL 16 上运行：事务、行锁、部分唯一索引与触发器都是真的。
 */
@Testcontainers
@SpringBootTest(properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=false",
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TrustedMeetingFlowIT {

    @Container
    @SuppressWarnings("resource")
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("campus_market_tmf")
            .withUsername("campus_tmf").withPassword("campus_tmf_only");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        registry.add("campus-market.jwt-secret", () -> "trusted-meeting-flow-secret-01234567");
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired OrderService orders;

    // ==================================================================
    // 3.3A 快照
    // ==================================================================

    @Nested
    @DisplayName("3.3A 订单验货快照")
    class Snapshot {

        @Test
        @DisplayName("1. 下单时生成快照：条目与模板一致，卖家声明被原样复制")
        void snapshotIsCreated() throws Exception {
            Deal d = deal("数码电子", items -> items.get(1).put("condition", "DEFECT"));
            JsonNode inspection = flow(d.buyer(), d.orderId()).path("inspection");
            assertThat(inspection.path("status").asText()).isEqualTo("PENDING");
            assertThat(inspection.path("templateTitle").asText()).isEqualTo("数码电子验货清单");
            assertThat(inspection.path("templateVersion").asInt()).isEqualTo(1);
            assertThat(inspection.path("items")).hasSize(8);
            assertThat(item(inspection, "SCREEN").path("sellerCondition").asText()).isEqualTo("DEFECT");
        }

        @Test
        @DisplayName("2. 商品编辑后声明变化，已生成订单的快照不变")
        void snapshotIsImmutableAgainstProductEdits() throws Exception {
            Deal d = deal("数码电子", items -> {});
            cancel(d);   // 释放商品，才能编辑
            patchJson(d.seller(), "/v1/products/" + d.productId(),
                    Map.of("inspection", InspectionFixtures.disclosure("数码电子", "DEFECT")), 200);

            JsonNode inspection = flow(d.buyer(), d.orderId()).path("inspection");
            assertThat(item(inspection, "SCREEN").path("sellerCondition").asText())
                    .as("订单上看到的永远是下单时的声明").isEqualTo("NORMAL");
        }

        @Test
        @DisplayName("3. 幂等下单重放不重复生成快照")
        void idempotentReplayDoesNotDuplicate() throws Exception {
            User seller = register(), buyer = register();
            String productId = publish(seller, "数码电子", InspectionFixtures.fullDisclosure("数码电子"));
            Map<String, Object> body = orderBody(productId);
            String key = UUID.randomUUID().toString();
            String first = data(createOrder(buyer, body, key)).path("id").asText();
            String second = data(createOrder(buyer, body, key)).path("id").asText();
            assertThat(second).isEqualTo(first);
            assertThat(count("SELECT count(*) FROM order_inspections WHERE order_id=?::uuid", first)).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM order_inspection_items WHERE order_id=?::uuid", first)).isEqualTo(8);
        }

        @Test
        @DisplayName("4. 并发抢同一件商品：只产生一笔订单与一份快照")
        void concurrentOrdersProduceSingleSnapshot() throws Exception {
            User seller = register();
            String productId = publish(seller, "数码电子", InspectionFixtures.fullDisclosure("数码电子"));
            List<User> buyers = new ArrayList<>();
            for (int i = 0; i < 6; i++) buyers.add(register());
            List<Integer> statuses = concurrently(6, i ->
                    createOrder(buyers.get(i), orderBody(productId), UUID.randomUUID().toString()).getResponse().getStatus());
            assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM order_inspections i JOIN orders o ON o.id=i.order_id "
                    + "WHERE o.product_id=?::uuid", productId)).isEqualTo(1);
        }

        @Test
        @DisplayName("5. 无结构化声明的商品：订单明确标记 NOT_PROVIDED，不伪造清单，原流程可继续")
        void productWithoutDisclosure() throws Exception {
            Deal d = deal("其他", null);
            JsonNode flow = flow(d.buyer(), d.orderId());
            assertThat(flow.path("inspection").path("status").asText()).isEqualTo("NOT_PROVIDED");
            assertThat(flow.path("inspection").path("items")).isEmpty();
            // 3.8A：卖家接单之前，阻断原因是「未进入面交」而不是验货
            assertThat(flow.path("buyerConfirmBlockReason").asText()).isEqualTo("ORDER_NOT_IN_MEETING");
            // 既有状态机不变：买家确认仍须在卖家接单之后
            assertThat(status(transition(d.seller(), d.orderId(), "PENDING_MEETING"))).isEqualTo(200);
            assertThat(flow(d.buyer(), d.orderId()).path("buyerConfirmBlockReason").isNull()).as("无清单订单不受验货闸门影响").isTrue();
            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"))).isEqualTo(200);
        }

        @Test
        @DisplayName("6. 模块 3 之前的旧订单：LEGACY_NONE，原流程兼容")
        void legacyOrderWithoutInspectionRow() throws Exception {
            Deal d = deal("数码电子", items -> {});
            // 模拟 V5 之前创建的订单：没有任何验货记录（触发器禁止删除，只能直接造一笔旧订单）
            UUID legacy = legacyOrder(d);
            JsonNode flow = flow(d.buyer(), legacy.toString());
            assertThat(flow.path("inspection").path("status").asText()).isEqualTo("LEGACY_NONE");
            assertThat(status(transition(d.buyer(), legacy.toString(), "BUYER_CONFIRMED"))).isEqualTo(200);
        }
    }

    // ==================================================================
    // 3.3B～D 验货
    // ==================================================================

    @Nested
    @DisplayName("3.3 验货权限、草稿与提交")
    class Inspection {

        @Test
        @DisplayName("7. 权限矩阵：卖家 403、他人 404（读与写）；买家草稿对卖家不可见")
        void permissions() throws Exception {
            Deal d = meetingDeal();
            User stranger = register();
            List<Map<String, Object>> draft = results(d, "MATCH");
            assertThat(status(putJson(d.seller(), "/v1/orders/" + d.orderId() + "/inspection", Map.of("items", draft)))).isEqualTo(403);
            assertThat(status(postJson(d.seller(), "/v1/orders/" + d.orderId() + "/inspection/submit", Map.of("items", draft)))).isEqualTo(403);
            assertThat(status(putJson(stranger, "/v1/orders/" + d.orderId() + "/inspection", Map.of("items", draft)))).isEqualTo(404);
            assertThat(status(perform(get("/v1/orders/" + d.orderId() + "/flow"), stranger))).isEqualTo(404);

            assertThat(status(putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection", Map.of("items", draft)))).isEqualTo(200);
            assertThat(item(flow(d.buyer(), d.orderId()).path("inspection"), "SCREEN").path("buyerResult").asText()).isEqualTo("MATCH");
            assertThat(item(flow(d.seller(), d.orderId()).path("inspection"), "SCREEN").path("buyerResult").isNull())
                    .as("草稿是买家自己的工作状态，卖家看不到").isTrue();
        }

        @Test
        @DisplayName("8. 草稿可反复保存；最终提交后服务端写入提交人与时间，记录冻结")
        void draftThenSubmit() throws Exception {
            Deal d = meetingDeal();
            putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection", Map.of("items", results(d, "MISMATCH")));
            putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection", Map.of("items", results(d, "MATCH")));
            assertThat(status(submit(d, results(d, "MATCH")))).isEqualTo(200);

            JsonNode inspection = flow(d.seller(), d.orderId()).path("inspection");
            assertThat(inspection.path("status").asText()).isEqualTo("SUBMITTED");
            assertThat(inspection.path("submittedAtIso").asText()).isNotBlank();
            assertThat(item(inspection, "SCREEN").path("checkedAtIso").asText()).isNotBlank();
            assertThat(item(inspection, "SCREEN").path("buyerResult").asText()).as("提交后卖家可见").isEqualTo("MATCH");
            assertThat(jdbc.queryForObject("SELECT submitted_by::text FROM order_inspections WHERE order_id=?::uuid",
                    String.class, d.orderId())).isEqualTo(d.buyer().id());

            assertThat(status(submit(d, results(d, "MATCH")))).as("相同内容重放幂等").isEqualTo(200);
            assertThat(status(submit(d, results(d, "NOT_CHECKABLE")))).as("内容不同不可修改").isEqualTo(409);
            assertThat(status(putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection",
                    Map.of("items", results(d, "MISMATCH"))))).as("提交后不能再存草稿").isEqualTo(409);
            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"))).isEqualTo(200);
        }

        @Test
        @DisplayName("9. 并发最终提交：只有一次生效，只有一条提交事件")
        void concurrentSubmit() throws Exception {
            Deal d = meetingDeal();
            List<Map<String, Object>> items = results(d, "MATCH");
            List<Integer> statuses = concurrently(8, i -> status(submit(d, items)));
            assertThat(statuses).allMatch(s -> s == 200);
            assertThat(count("SELECT count(*) FROM order_flow_events WHERE order_id=?::uuid AND event_code='INSPECTION_SUBMITTED'",
                    d.orderId())).isEqualTo(1);
        }

        @Test
        @DisplayName("10. 未提交验货时买家确认被拦；被拦不消耗确认码次数")
        void pendingInspectionBlocksConfirmation() throws Exception {
            Deal d = meetingDeal();
            assertThat(flow(d.buyer(), d.orderId()).path("buyerConfirmBlockReason").asText()).isEqualTo("INSPECTION_REQUIRED");
            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"))).isEqualTo(409);
            assertThat(orderStatus(d.orderId())).isEqualTo("PENDING_MEETING");
            assertThat(count("SELECT code_attempts FROM orders WHERE id=?::uuid", d.orderId())).isZero();
        }

        @Test
        @DisplayName("11. 存在不一致：进入 DISPUTED，确认与核销都被拦、确认码次数不变；取消后商品释放")
        void mismatchIsNotBypassable() throws Exception {
            Deal d = meetingDeal();
            List<Map<String, Object>> items = results(d, "MATCH");
            items.get(0).put("result", "MISMATCH");
            items.get(0).put("note", "屏幕有裂纹，与声明不符");
            assertThat(status(submit(d, items))).isEqualTo(200);

            JsonNode flow = flow(d.buyer(), d.orderId());
            assertThat(flow.path("inspection").path("status").asText()).isEqualTo("NEEDS_RESOLUTION");
            assertThat(flow.path("buyerConfirmBlockReason").asText()).isEqualTo("INSPECTION_MISMATCH");
            assertThat(orderStatus(d.orderId())).isEqualTo("DISPUTED");

            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"))).isEqualTo(409);
            MvcResult complete = postJson(d.seller(), "/v1/orders/" + d.orderId() + "/transitions",
                    Map.of("to", "COMPLETED", "confirmationCode", confirmationCode(d)));
            assertThat(status(complete)).as("卖家不能凭确认码绕过验货").isEqualTo(409);
            assertThat(count("SELECT code_attempts FROM orders WHERE id=?::uuid", d.orderId())).isZero();
            assertThat(orderStatus(d.orderId())).isEqualTo("DISPUTED");

            // 争议的出口：任一方取消，商品回到在售
            assertThat(status(transition(d.seller(), d.orderId(), "CANCELLED"))).isEqualTo(200);
            assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, d.productId())).isEqualTo("在售");
        }

        @Test
        @DisplayName("12. DISPUTED 到期同样释放商品，不会被永久占用")
        void disputedOrdersExpire() throws Exception {
            Deal d = meetingDeal();
            List<Map<String, Object>> items = results(d, "MATCH");
            items.get(0).put("result", "MISMATCH");
            submit(d, items);
            jdbc.update("UPDATE orders SET expires_at = now() - interval '1 minute' WHERE id=?::uuid", d.orderId());
            flow(d.buyer(), d.orderId());
            orders.expire();
            assertThat(orderStatus(d.orderId())).isEqualTo("EXPIRED");
            assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id=?::uuid", String.class, d.productId())).isEqualTo("在售");
        }

        @Test
        @DisplayName("13. 越权与格式：服务端字段 400；缺项提交 400；未知条目 400；非面交阶段 409")
        void validation() throws Exception {
            Deal d = meetingDeal();
            for (String field : List.of("sellerId", "buyerId", "orderId", "submittedAt", "checkedAt")) {
                Map<String, Object> body = new LinkedHashMap<>(Map.of("items", results(d, "MATCH")));
                body.put(field, "x");
                assertThat(status(postJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection/submit", body))).as(field).isEqualTo(400);
                List<Map<String, Object>> items = results(d, "MATCH");
                items.get(0).put(field, "x");
                assertThat(status(submit(d, items))).as("条目内 %s", field).isEqualTo(400);
            }
            List<Map<String, Object>> partial = results(d, "MATCH");
            partial.remove(0);
            assertThat(status(submit(d, partial))).isEqualTo(400);
            List<Map<String, Object>> unknown = results(d, "MATCH");
            unknown.get(0).put("itemCode", "NOT_A_CODE");
            assertThat(status(submit(d, unknown))).isEqualTo(400);

            Deal early = deal("数码电子", items -> {});   // 卖家尚未接单
            assertThat(status(submit(early, results(early, "MATCH")))).isEqualTo(409);
        }
    }

    // ==================================================================
    // 3.4 档期握手
    // ==================================================================

    @Nested
    @DisplayName("3.4 档期握手与改约")
    class Meeting {

        @Test
        @DisplayName("14. 提议不会清空原档期；自己不能接受；他人 404；对方接受后新档期生效、版本 +1、过期时间顺延")
        void proposeAndAccept() throws Exception {
            Deal d = meetingDeal();
            JsonNode before = flow(d.buyer(), d.orderId()).path("agreement");
            OffsetDateTime starts = slot(3);
            String proposalId = propose(d.buyer(), d, starts, 30);

            JsonNode during = flow(d.seller(), d.orderId());
            assertThat(during.path("agreement")).as("对方接受之前，原档期继续有效").isEqualTo(before);
            assertThat(status(accept(d.buyer(), d, proposalId))).isEqualTo(403);
            assertThat(status(accept(register(), d, proposalId))).isEqualTo(404);

            assertThat(status(accept(d.seller(), d, proposalId))).isEqualTo(200);
            JsonNode after = flow(d.buyer(), d.orderId()).path("agreement");
            assertThat(after.path("revision").asInt()).isEqualTo(1);
            assertThat(OffsetDateTime.parse(after.path("startsAtIso").asText()).toInstant()).isEqualTo(starts.toInstant());
            assertThat(jdbc.queryForObject("SELECT expires_at FROM orders WHERE id=?::uuid", java.sql.Timestamp.class, d.orderId())
                    .toInstant()).as("改约到更晚，过期时间同步顺延").isEqualTo(starts.plusDays(1).toInstant());
            assertThat(status(accept(d.seller(), d, proposalId))).as("重复接受幂等").isEqualTo(200);
        }

        @Test
        @DisplayName("15. 拒绝与撤回：原档期不变；对方不能替我撤回；已处理的提议再操作 409")
        void rejectAndWithdraw() throws Exception {
            Deal d = meetingDeal();
            JsonNode before = flow(d.buyer(), d.orderId()).path("agreement");
            String p1 = propose(d.buyer(), d, slot(3), 60);
            assertThat(status(reject(d.seller(), d, p1))).isEqualTo(200);
            assertThat(status(accept(d.seller(), d, p1))).isEqualTo(409);
            assertThat(flow(d.buyer(), d.orderId()).path("agreement")).isEqualTo(before);

            String p2 = propose(d.seller(), d, slot(4), 30);
            assertThat(status(withdraw(d.buyer(), d, p2))).isEqualTo(403);
            assertThat(status(withdraw(d.seller(), d, p2))).isEqualTo(200);
            assertThat(status(withdraw(d.seller(), d, p2))).as("重复撤回幂等").isEqualTo(200);
            assertThat(flow(d.buyer(), d.orderId()).path("agreement")).isEqualTo(before);
        }

        @Test
        @DisplayName("16. 同一订单同时只能有一个待处理提议")
        void onePendingProposal() throws Exception {
            Deal d = meetingDeal();
            propose(d.buyer(), d, slot(3), 30);
            assertThat(status(proposeRaw(d.seller(), d, slot(4), 30, d.meetingPointId()))).isEqualTo(409);
        }

        @Test
        @DisplayName("17. 并发接受：8 个请求同时接受同一提议，只产生一个当前档期与一条接受事件")
        void concurrentAccept() throws Exception {
            Deal d = meetingDeal();
            String proposalId = propose(d.buyer(), d, slot(3), 30);
            List<Integer> statuses = concurrently(8, i -> status(accept(d.seller(), d, proposalId)));
            assertThat(statuses).allMatch(s -> s == 200);
            assertThat(count("SELECT count(*) FROM order_meeting_proposals WHERE order_id=?::uuid AND status='ACCEPTED'", d.orderId())).isEqualTo(1);
            assertThat(count("SELECT meeting_revision FROM orders WHERE id=?::uuid", d.orderId())).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM order_flow_events WHERE order_id=?::uuid AND event_code='MEETING_ACCEPTED'", d.orderId())).isEqualTo(1);
        }

        @Test
        @DisplayName("18. 连续改约：旧协议标记 SUPERSEDED 并保留，始终只有一个当前协议")
        void rescheduleSupersedes() throws Exception {
            Deal d = meetingDeal();
            String p1 = propose(d.buyer(), d, slot(3), 30);
            accept(d.seller(), d, p1);
            String p2 = propose(d.seller(), d, slot(5), 30);
            accept(d.buyer(), d, p2);
            JsonNode flow = flow(d.buyer(), d.orderId());
            assertThat(flow.path("agreement").path("revision").asInt()).isEqualTo(2);
            List<String> statuses = new ArrayList<>();
            flow.path("proposals").forEach(p -> statuses.add(p.path("status").asText()));
            assertThat(statuses).containsExactly("SUPERSEDED", "ACCEPTED");
        }

        @Test
        @DisplayName("19. 面交点与时间校验：停用 400、跨校区 400、非整/半点 400、超过 2 小时 400、过去的时间 400")
        void validation() throws Exception {
            Deal d = meetingDeal();
            jdbc.update("UPDATE meeting_points SET active=false WHERE id='东校区-express'");
            try {
                assertThat(status(proposeRaw(d.buyer(), d, slot(3), 30, "东校区-express"))).isEqualTo(400);
            } finally {
                jdbc.update("UPDATE meeting_points SET active=true WHERE id='东校区-express'");
            }
            assertThat(status(proposeRaw(d.buyer(), d, slot(3), 30, "西校区-library"))).isEqualTo(400);
            assertThat(status(proposeRaw(d.buyer(), d, slot(3).plusMinutes(7), 30, d.meetingPointId()))).isEqualTo(400);
            assertThat(status(proposeRaw(d.buyer(), d, slot(3), 150, d.meetingPointId()))).isEqualTo(400);
            assertThat(status(proposeRaw(d.buyer(), d, slot(-24 * 3), 30, d.meetingPointId()))).isEqualTo(400);
            Map<String, Object> body = proposalBody(slot(3), 30, d.meetingPointId());
            body.put("proposerId", d.seller().id());
            assertThat(status(postJson(d.buyer(), "/v1/orders/" + d.orderId() + "/meeting-proposals", body))).isEqualTo(400);
        }

        @Test
        @DisplayName("19b. 停用面交点：列表仍返回并标 active=false；新下单被拒 400，不产生订单与快照，商品仍在售")
        void inactiveMeetingPointRejectsNewOrders() throws Exception {
            User seller = register();
            String productId = publish(seller, "生活用品", InspectionFixtures.fullDisclosure("生活用品"));
            User buyer = register();
            jdbc.update("UPDATE meeting_points SET active=false WHERE id='东校区-library'");
            try {
                JsonNode points = data(mockMvc.perform(get("/v1/meeting-points")).andReturn());
                Map<String, Boolean> active = new java.util.HashMap<>();
                points.forEach(p -> active.put(p.path("id").asText(), p.path("active").asBoolean()));
                assertThat(active).containsEntry("东校区-library", false).containsEntry("东校区-canteen", true);

                assertThat(status(createOrder(buyer, orderBody(productId), UUID.randomUUID().toString()))).isEqualTo(400);
                assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id = ?::uuid", Long.class, productId)).isZero();
                assertThat(jdbc.queryForObject("SELECT count(*) FROM order_inspections i JOIN orders o ON o.id = i.order_id "
                        + "WHERE o.product_id = ?::uuid", Long.class, productId)).isZero();
                assertThat(jdbc.queryForObject("SELECT status FROM products WHERE id = ?::uuid", String.class, productId)).isEqualTo("在售");
            } finally {
                jdbc.update("UPDATE meeting_points SET active=true WHERE id='东校区-library'");
            }
            // 恢复启用后同一请求可以下单：拒绝来自停用状态，而不是别的校验
            assertThat(status(createOrder(buyer, orderBody(productId), UUID.randomUUID().toString()))).isEqualTo(200);
        }

        @Test
        @DisplayName("20. 终态订单禁止改约")
        void terminalOrdersCannotReschedule() throws Exception {
            Deal d = meetingDeal();
            cancel(d);
            assertThat(status(proposeRaw(d.buyer(), d, slot(3), 30, d.meetingPointId()))).isEqualTo(409);
        }
    }

    // ==================================================================
    // 3.5 出发 / 已到
    // ==================================================================

    @Nested
    @DisplayName("3.5 出发与已到")
    class Presence {

        @Test
        @DisplayName("21. 只能改自己的状态；对方可见；重复请求幂等；到达后不能退回；他人 404")
        void ownPresenceOnly() throws Exception {
            Deal d = meetingDeal();
            assertThat(status(presence(register(), d, "DEPART"))).isEqualTo(404);
            assertThat(status(presence(d.buyer(), d, "DEPART"))).isEqualTo(200);
            assertThat(status(presence(d.buyer(), d, "DEPART"))).isEqualTo(200);
            JsonNode seen = flow(d.seller(), d.orderId()).path("presence");
            assertThat(seen.path("counterpart").path("status").asText()).isEqualTo("DEPARTED");
            assertThat(seen.path("me").path("status").asText()).as("买家的动作没有改到卖家").isEqualTo("NOT_STARTED");
            assertThat(seen.path("counterpart").path("departedAtIso").asText()).as("时间由服务端生成").isNotBlank();

            assertThat(status(presence(d.buyer(), d, "ARRIVE"))).isEqualTo(200);
            assertThat(status(presence(d.buyer(), d, "ARRIVE"))).isEqualTo(200);
            assertThat(status(presence(d.buyer(), d, "DEPART"))).as("不能倒退").isEqualTo(409);
            assertThat(count("SELECT count(*) FROM order_flow_events WHERE order_id=?::uuid AND event_code LIKE 'PRESENCE_%'",
                    d.orderId())).as("幂等请求不重复记事件").isEqualTo(2);
        }

        @Test
        @DisplayName("22. 双标签页快速连点：状态只会前进，不会写出非法倒退")
        void concurrentClicks() throws Exception {
            // 多轮、每轮 12 个请求同时打到同一个人的状态上：只允许 200（成功或幂等）与 409（拒绝倒退），
            // 绝不能出现 500；最终必须是 ARRIVED，且出发 / 到达事件各至多一条
            for (int round = 0; round < 5; round++) {
                Deal d = meetingDeal();
                List<Integer> statuses = concurrently(12, i -> status(presence(d.buyer(), d, i % 2 == 0 ? "DEPART" : "ARRIVE")));
                assertThat(statuses).as("第 %d 轮", round).allMatch(s -> s == 200 || s == 409);
                String finalStatus = jdbc.queryForObject("SELECT status FROM order_presence WHERE order_id=?::uuid AND user_id=?::uuid",
                        String.class, d.orderId(), d.buyer().id());
                assertThat(finalStatus).isEqualTo("ARRIVED");
                assertThat(count("SELECT count(*) FROM order_flow_events WHERE order_id=?::uuid AND event_code='PRESENCE_ARRIVED'",
                        d.orderId())).isEqualTo(1);
                assertThat(count("SELECT count(*) FROM order_flow_events WHERE order_id=?::uuid AND event_code='PRESENCE_DEPARTED'",
                        d.orderId())).isLessThanOrEqualTo(1);
                assertThat(status(presence(d.buyer(), d, "DEPART"))).isEqualTo(409);
            }
        }

        @Test
        @DisplayName("23. 改约生效后按新版本重新开始，旧版本记录保留")
        void newRevisionRestarts() throws Exception {
            Deal d = meetingDeal();
            presence(d.buyer(), d, "ARRIVE");
            String p = propose(d.seller(), d, slot(3), 30);
            accept(d.buyer(), d, p);
            JsonNode me = flow(d.buyer(), d.orderId()).path("presence");
            assertThat(me.path("revision").asInt()).isEqualTo(1);
            assertThat(me.path("me").path("status").asText()).isEqualTo("NOT_STARTED");
            assertThat(count("SELECT count(*) FROM order_presence WHERE order_id=?::uuid AND meeting_revision=0", d.orderId())).isEqualTo(1);
        }

        @Test
        @DisplayName("24. 到达不会完成订单、不会提交验货、不会暴露联系方式")
        void arrivalHasNoSideEffects() throws Exception {
            Deal d = meetingDeal();
            presence(d.buyer(), d, "ARRIVE");
            presence(d.seller(), d, "ARRIVE");
            assertThat(orderStatus(d.orderId())).isEqualTo("PENDING_MEETING");
            JsonNode flow = flow(d.buyer(), d.orderId());
            assertThat(flow.path("inspection").path("status").asText()).isEqualTo("PENDING");
            assertThat(flow.toString()).doesNotContain("13800000000").doesNotContain(confirmationCode(d));
        }

        @Test
        @DisplayName("25. 卖家接单前与终态订单禁止更新；不接受坐标等额外字段；表中无定位字段")
        void presenceGuards() throws Exception {
            Deal early = deal("数码电子", items -> {});
            assertThat(status(presence(early.buyer(), early, "DEPART"))).isEqualTo(409);

            Deal d = meetingDeal();
            Map<String, Object> body = new LinkedHashMap<>(Map.of("action", "ARRIVE"));
            body.put("latitude", 31.0);
            assertThat(status(putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/presence", body))).isEqualTo(400);
            assertThat(status(putJson(d.buyer(), "/v1/orders/" + d.orderId() + "/presence", Map.of("action", "TELEPORT")))).isEqualTo(400);
            cancel(d);
            assertThat(status(presence(d.buyer(), d, "ARRIVE"))).isEqualTo(409);
            assertThat(jdbc.queryForList("SELECT column_name FROM information_schema.columns WHERE table_name='order_presence'", String.class))
                    .noneSatisfy(c -> assertThat(c).containsAnyOf("lat", "lng", "lon", "accuracy", "location", "device"));
        }
    }

    // ==================================================================
    // 3.6 时间线与履历
    // ==================================================================

    @Nested
    @DisplayName("3.6 时间线与履历")
    class History {

        @Test
        @DisplayName("26. 时间线是稳定的机器码序列，不含确认码、联系方式或取消原因原文")
        void timeline() throws Exception {
            Deal d = meetingDeal();
            String p = propose(d.buyer(), d, slot(3), 30);
            accept(d.seller(), d, p);
            presence(d.buyer(), d, "DEPART");
            presence(d.buyer(), d, "ARRIVE");
            submit(d, results(d, "MATCH"));
            transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED");
            postJson(d.seller(), "/v1/orders/" + d.orderId() + "/transitions",
                    Map.of("to", "COMPLETED", "confirmationCode", confirmationCode(d)));

            JsonNode timeline = flow(d.buyer(), d.orderId()).path("timeline");
            List<String> codes = new ArrayList<>();
            timeline.forEach(e -> codes.add(e.path("code").asText()));
            assertThat(codes).containsExactly("ORDER_CREATED", "SELLER_ACCEPTED", "MEETING_PROPOSED", "MEETING_ACCEPTED",
                    "PRESENCE_DEPARTED", "PRESENCE_ARRIVED", "INSPECTION_SUBMITTED", "BUYER_CONFIRMED",
                    "SELLER_VERIFIED", "ORDER_COMPLETED");
            assertThat(flow(d.seller(), d.orderId()).path("timeline")).as("双方看到同一顺序").isEqualTo(timeline);
            assertThat(timeline.toString()).doesNotContain(confirmationCode(d)).doesNotContain("13800000000");
        }

        @Test
        @DisplayName("27. 本人履历：计数与最近订单入口")
        void ownHistory() throws Exception {
            Deal done = completedDeal();
            Deal cancelled = meetingDeal();
            cancel(cancelled);
            JsonNode mine = data(perform(get("/v1/me/trade-history"), done.buyer()));
            assertThat(mine.path("completed").asLong()).isEqualTo(1);
            assertThat(mine.path("completedAsBuyer").asLong()).isEqualTo(1);
            assertThat(mine.path("recent").get(0).path("orderId").asText()).isEqualTo(done.orderId());
            JsonNode sellerSide = data(perform(get("/v1/me/trade-history"), cancelled.seller()));
            assertThat(sellerSide.path("cancelled").asLong()).isEqualTo(1);
        }

        @Test
        @DisplayName("28. 公共履历只有聚合白名单；小样本评价均分隐藏")
        void publicSummary() throws Exception {
            Deal d = completedDeal();
            postJson(d.buyer(), "/v1/orders/" + d.orderId() + "/reviews", Map.of("rating", 5, "comment", "很好"));
            JsonNode summary = data(mockMvc.perform(get("/v1/users/" + d.seller().id() + "/trade-summary").header("Authorization", "Bearer " + d.buyer().token())).andReturn());
            List<String> fields = new ArrayList<>();
            summary.fieldNames().forEachRemaining(fields::add);
            assertThat(fields).containsExactlyInAnyOrder("completedCount", "joinedAt", "reviewCount", "averageRating");
            assertThat(summary.path("completedCount").asLong()).isEqualTo(1);
            assertThat(summary.path("reviewCount").asLong()).isEqualTo(1);
            assertThat(summary.path("averageRating").isNull()).as("不足 3 条评价不展示均分").isTrue();
            String raw = summary.toString();
            assertThat(raw).doesNotContain(d.orderId()).doesNotContain(d.productId()).doesNotContain(d.buyer().id())
                    .doesNotContain("dormBuilding").doesNotContain("13800000000").doesNotContain(confirmationCode(d));

            for (int i = 0; i < 2; i++) {
                Deal more = completedDealFor(d.seller());
                postJson(more.buyer(), "/v1/orders/" + more.orderId() + "/reviews", Map.of("rating", 4, "comment", "不错"));
            }
            JsonNode enough = data(mockMvc.perform(get("/v1/users/" + d.seller().id() + "/trade-summary").header("Authorization", "Bearer " + d.buyer().token())).andReturn());
            assertThat(enough.path("reviewCount").asLong()).isEqualTo(3);
            assertThat(enough.path("averageRating").asDouble()).isEqualTo(4.3);
            assertThat(status(mockMvc.perform(get("/v1/users/" + UUID.randomUUID() + "/trade-summary").header("Authorization", "Bearer " + d.buyer().token())).andReturn())).isEqualTo(404);
        }
    }

    // ==================================================================
    // 3.8 收口：订单列表可操作性、正式档期只在面交阶段建立
    // ==================================================================

    @Nested
    @DisplayName("3.8 订单列表可操作性与档期收口")
    class Closure {

        @Test
        @DisplayName("38.1 列表摘要逐阶段变化，且与真实迁移结果一致（允许 ⇔ 200，禁止 ⇔ 409）")
        void listSummaryMatchesStateMachine() throws Exception {
            Deal d = deal("数码电子", items -> {});
            JsonNode s = listed(d.buyer(), d.orderId()).path("flow");
            assertThat(s.path("buyerConfirmAllowed").asBoolean()).isFalse();
            assertThat(s.path("buyerConfirmBlockReason").asText()).isEqualTo("ORDER_NOT_IN_MEETING");
            assertThat(s.path("currentMeetingStatus").asText()).isEqualTo("AWAITING_SELLER");
            assertThat(s.path("inspectionRequired").asBoolean()).isTrue();
            assertThat(s.path("inspectionStatus").asText()).isEqualTo("PENDING");
            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED"))).isEqualTo(409);

            MvcResult accepted = transition(d.seller(), d.orderId(), "PENDING_MEETING");
            assertThat(data(accepted).path("flow").path("currentMeetingStatus").asText())
                    .as("迁移的返回值带同一份摘要").isEqualTo("CONFIRMED");
            s = listed(d.buyer(), d.orderId()).path("flow");
            assertThat(s.path("buyerConfirmBlockReason").asText()).isEqualTo("INSPECTION_REQUIRED");
            assertThat(status(transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED")))
                    .as("界面禁用只是体验优化，后端 409 防线仍在").isEqualTo(409);

            submit(d, results(d, "MATCH"));
            s = listed(d.buyer(), d.orderId()).path("flow");
            assertThat(s.path("buyerConfirmAllowed").asBoolean()).isTrue();
            assertThat(s.path("buyerConfirmBlockReason").isNull()).isTrue();
            assertThat(s.path("inspectionStatus").asText()).isEqualTo("SUBMITTED");
            MvcResult confirmed = transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED");
            assertThat(status(confirmed)).isEqualTo(200);
            assertThat(data(confirmed).path("flow").path("buyerConfirmBlockReason").asText()).isEqualTo("ALREADY_CONFIRMED");

            postJson(d.seller(), "/v1/orders/" + d.orderId() + "/transitions",
                    Map.of("to", "COMPLETED", "confirmationCode", confirmationCode(d)));
            s = listed(d.seller(), d.orderId()).path("flow");
            assertThat(s.path("buyerConfirmBlockReason").asText()).isEqualTo("ORDER_TERMINAL");
            assertThat(s.path("currentMeetingStatus").asText()).isEqualTo("CLOSED");
        }

        @Test
        @DisplayName("38.2 验货不一致：双方列表都给出 INSPECTION_MISMATCH，响应里没有任何仲裁 / 赔付字样")
        void mismatchIsReportedWithoutArbitration() throws Exception {
            Deal d = meetingDeal();
            List<Map<String, Object>> items = results(d, "MATCH");
            items.get(0).put("result", "MISMATCH");
            submit(d, items);
            for (User who : List.of(d.buyer(), d.seller())) {
                JsonNode order = listed(who, d.orderId());
                assertThat(order.path("canonicalStatus").asText()).isEqualTo("DISPUTED");
                assertThat(order.path("flow").path("buyerConfirmBlockReason").asText()).isEqualTo("INSPECTION_MISMATCH");
                assertThat(order.path("flow").path("inspectionStatus").asText()).isEqualTo("NEEDS_RESOLUTION");
                assertThat(order.toString()).doesNotContain("仲裁").doesNotContain("赔付").doesNotContain("退款");
            }
        }

        @Test
        @DisplayName("38.3 无清单与旧订单：inspectionRequired=false，接单后即可确认，兼容原流程")
        void legacyAndUndeclaredStayCompatible() throws Exception {
            Deal undeclared = deal("其他", null);
            transition(undeclared.seller(), undeclared.orderId(), "PENDING_MEETING");
            JsonNode s = listed(undeclared.buyer(), undeclared.orderId()).path("flow");
            assertThat(s.path("inspectionRequired").asBoolean()).isFalse();
            assertThat(s.path("inspectionStatus").asText()).isEqualTo("NOT_PROVIDED");
            assertThat(s.path("buyerConfirmAllowed").asBoolean()).isTrue();

            Deal base = deal("其他", null);
            UUID legacy = legacyOrder(base);
            s = listed(base.buyer(), legacy.toString()).path("flow");
            assertThat(s.path("inspectionStatus").asText()).isEqualTo("LEGACY_NONE");
            assertThat(s.path("inspectionRequired").asBoolean()).isFalse();
            assertThat(s.path("buyerConfirmAllowed").asBoolean()).isTrue();
            assertThat(status(transition(base.buyer(), legacy.toString(), "BUYER_CONFIRMED"))).isEqualTo(200);
        }

        @Test
        @DisplayName("38.4 到达与改约反映在列表里：本人 / 对方视角正确；改约接受后到达状态按新版本重新开始")
        void presenceAndRescheduleInList() throws Exception {
            Deal d = meetingDeal();
            presence(d.buyer(), d, "DEPART");
            JsonNode mine = listed(d.buyer(), d.orderId()).path("flow");
            JsonNode theirs = listed(d.seller(), d.orderId()).path("flow");
            assertThat(mine.path("myPresenceStatus").asText()).isEqualTo("DEPARTED");
            assertThat(mine.path("counterpartyPresenceStatus").asText()).isEqualTo("NOT_STARTED");
            assertThat(theirs.path("myPresenceStatus").asText()).isEqualTo("NOT_STARTED");
            assertThat(theirs.path("counterpartyPresenceStatus").asText()).isEqualTo("DEPARTED");

            String proposalId = propose(d.seller(), d, slot(3), 60);
            assertThat(listed(d.buyer(), d.orderId()).path("flow").path("currentMeetingStatus").asText()).isEqualTo("RESCHEDULE_PENDING");
            assertThat(status(accept(d.buyer(), d, proposalId))).isEqualTo(200);
            JsonNode after = listed(d.buyer(), d.orderId()).path("flow");
            assertThat(after.path("currentMeetingStatus").asText()).isEqualTo("CONFIRMED");
            assertThat(after.path("myPresenceStatus").asText()).isEqualTo("NOT_STARTED");
        }

        @Test
        @DisplayName("38.5 订单列表语句数与订单数量无关：1 笔与 100 笔相同（不逐单查询流程或评价）")
        void listStatementCountIsConstant(@Autowired org.apache.ibatis.session.SqlSessionFactory sessions) throws Exception {
            User one = register();
            User many = register();
            User seller = register();
            seedOrders(one, seller, 1);
            seedOrders(many, seller, 100);
            com.lulu.campusmarketbackend.support.StatementCounter counter =
                    com.lulu.campusmarketbackend.support.StatementCounter.install(sessions);
            long single = counter.during(() -> assertThat(orders.list(one.id(), "all")).hasSize(1));
            long hundred = counter.during(() -> assertThat(orders.list(many.id(), "all")).hasSize(100));
            System.out.println("PLAN order list statements: 1 order -> " + single + ", 100 orders -> " + hundred);
            assertThat(single).isPositive();
            assertThat(hundred).as("评价与流程摘要都是批量取回").isEqualTo(single);
            // 摘要本身也要正确：100 笔里带验货与到达的订单
            List<Map<String, Object>> listed = orders.list(many.id(), "all");
            assertThat(listed.stream().filter(o -> "INSPECTION_REQUIRED".equals(((Map<?, ?>) o.get("flow")).get("buyerConfirmBlockReason"))))
                    .hasSize(50);
            assertThat(listed.stream().filter(o -> o.containsKey("buyerReview"))).hasSize(10);
        }

        @Test
        @DisplayName("38.6 3.8B：卖家接受之前不能提议正式档期（双方 409）；接受之后可以")
        void proposalsOnlyAfterSellerAccepts() throws Exception {
            Deal d = deal("数码电子", items -> {});
            for (User who : List.of(d.buyer(), d.seller())) {
                MvcResult r = proposeRaw(who, d, slot(3), 60, d.meetingPointId());
                assertThat(status(r)).isEqualTo(409);
                assertThat(r.getResponse().getContentAsString()).contains("卖家接受预约后").contains("requestId");
            }
            assertThat(count("SELECT count(*) FROM order_meeting_proposals WHERE order_id=?::uuid", d.orderId())).isZero();
            transition(d.seller(), d.orderId(), "PENDING_MEETING");
            assertThat(status(proposeRaw(d.buyer(), d, slot(3), 60, d.meetingPointId()))).isEqualTo(200);
        }

        /**
         * 直接写库造 N 笔订单：前 10 笔已完成且带买家评价；第 10～59 笔处于待面交、验货清单待提交；
         * 其余无清单。每笔都有买家「已出发」记录。用 SQL 造数只为测语句数，行为测试仍走 HTTP。
         */
        private void seedOrders(User buyer, User seller, int n) {
            for (int i = 0; i < n; i++) {
                UUID product = UUID.randomUUID();
                UUID order = UUID.randomUUID();
                boolean done = i < 10;
                jdbc.update("INSERT INTO products(id,seller_id,title,description,price,category,condition,campus,status) "
                        + "VALUES (?,?::uuid,'批量','d',10,'其他','全新','东校区',?)", product, seller.id(), done ? "已售出" : "预约中");
                jdbc.update("INSERT INTO orders(id,product_id,buyer_id,seller_id,price,status,meeting_point_id,meeting_at,contact,"
                        + "confirmation_code,idempotency_key,request_hash,expires_at) VALUES (?,?,?::uuid,?::uuid,10,?,'东校区-library',"
                        + "now() + interval '2 days','c','123456',?,'h',now() + interval '3 days')",
                        order, product, buyer.id(), seller.id(), done ? "COMPLETED" : "PENDING_MEETING", "seed" + order);
                if (!done && i < 60) {
                    jdbc.update("INSERT INTO order_inspections(order_id,status,template_id,template_title_snapshot,template_version) "
                            + "VALUES (?,'PENDING','tpl-daily-v1','生活用品验货清单',1)", order);
                } else {
                    jdbc.update("INSERT INTO order_inspections(order_id,status) VALUES (?,'NOT_PROVIDED')", order);
                }
                jdbc.update("INSERT INTO order_presence(order_id,user_id,meeting_revision,status,departed_at) "
                        + "VALUES (?,?::uuid,0,'DEPARTED',now())", order, buyer.id());
                if (done) {
                    jdbc.update("INSERT INTO reviews(id,order_id,reviewer_id,rating,comment) VALUES (?,?,?::uuid,5,'好')",
                            UUID.randomUUID(), order, buyer.id());
                }
            }
        }
    }

    // ==================================================================
    // 辅助
    // ==================================================================

    record User(String id, String token) {}

    record Deal(User seller, User buyer, String productId, String orderId, String meetingPointId) {}

    @FunctionalInterface
    interface Tweak { void apply(List<Map<String, Object>> items); }

    private Deal deal(String category, Tweak tweak) throws Exception {
        return dealFor(register(), category, tweak);
    }

    private Deal dealFor(User seller, String category, Tweak tweak) throws Exception {
        User buyer = register();
        List<Map<String, Object>> items = InspectionFixtures.fullDisclosure(category);
        if (items != null && tweak != null) tweak.apply(items);
        String productId = publish(seller, category, items);
        MvcResult created = createOrder(buyer, orderBody(productId), UUID.randomUUID().toString());
        assertThat(status(created)).as("下单失败：%s", created.getResponse().getContentAsString()).isEqualTo(200);
        return new Deal(seller, buyer, productId, data(created).path("id").asText(), "东校区-library");
    }

    /** 卖家已接单、处于待面交的订单。 */
    private Deal meetingDeal() throws Exception {
        Deal d = deal("数码电子", items -> {});
        assertThat(status(transition(d.seller(), d.orderId(), "PENDING_MEETING"))).isEqualTo(200);
        return d;
    }

    private Deal completedDeal() throws Exception {
        return completedDealFor(register());
    }

    private Deal completedDealFor(User seller) throws Exception {
        Deal d = dealFor(seller, "数码电子", items -> {});
        transition(d.seller(), d.orderId(), "PENDING_MEETING");
        submit(d, results(d, "MATCH"));
        transition(d.buyer(), d.orderId(), "BUYER_CONFIRMED");
        MvcResult done = postJson(d.seller(), "/v1/orders/" + d.orderId() + "/transitions",
                Map.of("to", "COMPLETED", "confirmationCode", confirmationCode(d)));
        assertThat(status(done)).isEqualTo(200);
        return d;
    }

    private UUID legacyOrder(Deal d) {
        cancelSilently(d);
        UUID id = UUID.randomUUID();
        java.sql.Timestamp later = java.sql.Timestamp.from(java.time.Instant.now().plusSeconds(86_400));
        jdbc.update("UPDATE products SET status='预约中' WHERE id=?::uuid", d.productId());
        jdbc.update("INSERT INTO orders(id,product_id,buyer_id,seller_id,price,status,meeting_point_id,meeting_at,contact,"
                        + "confirmation_code,idempotency_key,request_hash,expires_at) VALUES (?,?::uuid,?::uuid,?::uuid,?,?,?,?,?,?,?,?,?)",
                id, d.productId(), d.buyer().id(), d.seller().id(), BigDecimal.TEN, "PENDING_MEETING", "东校区-library",
                later, "13800000000", "654321", "legacy" + id, "h", later);
        return id;
    }

    private void cancelSilently(Deal d) {
        jdbc.update("UPDATE orders SET status='CANCELLED' WHERE id=?::uuid", d.orderId());
    }

    private void cancel(Deal d) throws Exception {
        assertThat(status(transition(d.buyer(), d.orderId(), "CANCELLED"))).isEqualTo(200);
    }

    private String confirmationCode(Deal d) {
        return jdbc.queryForObject("SELECT confirmation_code FROM orders WHERE id=?::uuid", String.class, d.orderId());
    }

    private List<Map<String, Object>> results(Deal d, String result) throws Exception {
        List<Map<String, Object>> items = new ArrayList<>();
        for (JsonNode item : flow(d.buyer(), d.orderId()).path("inspection").path("items")) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("itemCode", item.path("code").asText());
            row.put("result", result);
            items.add(row);
        }
        return items;
    }

    private MvcResult submit(Deal d, List<Map<String, Object>> items) throws Exception {
        return postJson(d.buyer(), "/v1/orders/" + d.orderId() + "/inspection/submit", Map.of("items", items));
    }

    /** 未来某天的整点，确保满足「整点或半点」与「不能是过去」的规则。 */
    private static OffsetDateTime slot(int hoursFromNow) {
        return OffsetDateTime.now(ZoneOffset.UTC).plusDays(2).plusHours(hoursFromNow).truncatedTo(ChronoUnit.HOURS);
    }

    private Map<String, Object> proposalBody(OffsetDateTime starts, int minutes, String pointId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("meetingPointId", pointId);
        b.put("startsAtIso", starts.toString());
        b.put("endsAtIso", starts.plusMinutes(minutes).toString());
        b.put("note", "图书馆门口见");
        return b;
    }

    private MvcResult proposeRaw(User who, Deal d, OffsetDateTime starts, int minutes, String pointId) throws Exception {
        return postJson(who, "/v1/orders/" + d.orderId() + "/meeting-proposals", proposalBody(starts, minutes, pointId));
    }

    private String propose(User who, Deal d, OffsetDateTime starts, int minutes) throws Exception {
        MvcResult r = proposeRaw(who, d, starts, minutes, d.meetingPointId());
        assertThat(status(r)).as("提议失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        JsonNode proposals = data(r).path("proposals");
        return proposals.get(proposals.size() - 1).path("id").asText();
    }

    private MvcResult accept(User who, Deal d, String proposalId) throws Exception {
        return perform(post("/v1/orders/" + d.orderId() + "/meeting-proposals/" + proposalId + "/accept"), who);
    }

    private MvcResult reject(User who, Deal d, String proposalId) throws Exception {
        return perform(post("/v1/orders/" + d.orderId() + "/meeting-proposals/" + proposalId + "/reject"), who);
    }

    private MvcResult withdraw(User who, Deal d, String proposalId) throws Exception {
        return perform(post("/v1/orders/" + d.orderId() + "/meeting-proposals/" + proposalId + "/withdraw"), who);
    }

    private MvcResult presence(User who, Deal d, String action) throws Exception {
        return putJson(who, "/v1/orders/" + d.orderId() + "/presence", Map.of("action", action));
    }

    /** 从「我的订单」列表里取出某一笔订单（带 3.8A 流程摘要）。 */
    private JsonNode listed(User who, String orderId) throws Exception {
        MvcResult r = perform(get("/v1/orders?role=all"), who);
        assertThat(status(r)).isEqualTo(200);
        for (JsonNode order : data(r)) if (orderId.equals(order.path("id").asText())) return order;
        throw new AssertionError("列表中没有订单 " + orderId);
    }

    private JsonNode flow(User who, String orderId) throws Exception {
        MvcResult r = perform(get("/v1/orders/" + orderId + "/flow"), who);
        assertThat(status(r)).as("读取流程失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r);
    }

    private static JsonNode item(JsonNode inspection, String code) {
        for (JsonNode item : inspection.path("items")) if (code.equals(item.path("code").asText())) return item;
        throw new AssertionError("缺少条目 " + code);
    }

    private MvcResult transition(User who, String orderId, String to) throws Exception {
        // 模块 7：卖家确认之后的取消必须带结构化原因
        return postJson(who, "/v1/orders/" + orderId + "/transitions",
                "CANCELLED".equals(to) ? Map.of("to", to, "reasonCode", "CHANGED_MIND") : Map.of("to", to));
    }

    private String orderStatus(String orderId) {
        return jdbc.queryForObject("SELECT status FROM orders WHERE id=?::uuid", String.class, orderId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }

    private User register() throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("account", "tm" + UUID.randomUUID().toString().replace("-", ""));
        b.put("password", "test-password-2026");
        b.put("nickname", "面交");
        b.put("campus", "东校区");
        b.put("contact", "13800000000");
        MvcResult r = mockMvc.perform(post("/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(b))).andReturn();
        JsonNode d = data(r);
        return new User(d.path("user").path("id").asText(), d.path("accessToken").asText());
    }

    private String publish(User seller, String category, List<Map<String, Object>> inspection) throws Exception {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("title", "面交测试 " + UUID.randomUUID().toString().substring(0, 8));
        b.put("description", "d");
        b.put("price", 99);
        b.put("category", category);
        b.put("condition", "全新");
        b.put("campus", "东校区");
        b.put("images", List.of("https://example.invalid/a.png"));
        b.put("contact", "13800000000");
        if (inspection != null) b.put("inspection", inspection);
        MvcResult r = postJson(seller, "/v1/products", b);
        assertThat(status(r)).as("发布失败：%s", r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r).path("id").asText();
    }

    private Map<String, Object> orderBody(String productId) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("productId", productId);
        b.put("meetingPointId", "东校区-library");
        b.put("meetingAtIso", OffsetDateTime.now(ZoneOffset.UTC).plusDays(1).truncatedTo(ChronoUnit.HOURS).toString());
        b.put("contact", "13800000000");
        return b;
    }

    private MvcResult createOrder(User buyer, Map<String, Object> body, String key) throws Exception {
        return mockMvc.perform(post("/v1/orders").header("Authorization", "Bearer " + buyer.token())
                .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body))).andReturn();
    }

    private MvcResult perform(MockHttpServletRequestBuilder builder, User who) throws Exception {
        return mockMvc.perform(builder.header("Authorization", "Bearer " + who.token())).andReturn();
    }

    private MvcResult postJson(User who, String path, Object body) throws Exception {
        return perform(post(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
    }

    private MvcResult putJson(User who, String path, Object body) throws Exception {
        return perform(put(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
    }

    private MvcResult patchJson(User who, String path, Object body, int expected) throws Exception {
        MvcResult r = perform(patch(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body)), who);
        assertThat(status(r)).as("PATCH 失败：%s", r.getResponse().getContentAsString()).isEqualTo(expected);
        return r;
    }

    private JsonNode data(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString()).path("data");
    }

    private static int status(MvcResult r) { return r.getResponse().getStatus(); }

    @FunctionalInterface
    interface Indexed<T> { T apply(int i) throws Exception; }

    private static <T> List<T> concurrently(int threads, Indexed<T> task) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<T>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                int index = i;
                futures.add(pool.submit(() -> { gate.await(); return task.apply(index); }));
            }
            gate.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> f : futures) results.add(f.get(60, TimeUnit.SECONDS));
            return results;
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
    }
}
