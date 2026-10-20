package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Testcontainers
@SpringBootTest(properties={"spring.flyway.enabled=true","spring.flyway.baseline-on-migrate=false",
    "campus-market.rate-limit.contact-request.limit=5"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ContactRequestsIT {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:16-alpine")
        .withDatabaseName("contact_requests_test").withUsername("contact_test").withPassword("contact_test_only");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        r.add("campus-market.jwt-secret", () -> "contact-requests-it-secret-0123456789");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    private JsonNode data(MvcResult r) throws Exception { return json.readTree(r.getResponse().getContentAsString()).path("data"); }
    private MvcResult postAs(String path,String token,Object body) throws Exception {
        return mvc.perform(post(path).header("Authorization","Bearer "+token).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andReturn();
    }
    private String register() throws Exception {
        MvcResult r=postAs("/v1/auth/register","",Map.of("account","contact"+UUID.randomUUID().toString().replace("-",""),"nickname","用户","password","test-password-2026","campus","东校区","contact","13800000000"));
        assertThat(r.getResponse().getStatus()).isEqualTo(200);return data(r).path("accessToken").asText();
    }
    private String listing(String seller,boolean publicContact) throws Exception {
        Map<String,Object> b=new LinkedHashMap<>(Map.of("title","联系方式测试","description","仅商品展示","price",12,"category","其他","condition","全新","campus","东校区","images",List.of("https://example.invalid/a.png"),"contact","wechat:seller","contactPublic",publicContact));
        MvcResult r=postAs("/v1/products",seller,b);
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);
        return data(r).path("id").asText();
    }
    private JsonNode product(String id,String token) throws Exception {
        MvcResult r=mvc.perform(get("/v1/products/"+id).header("Authorization","Bearer "+token)).andReturn();
        assertThat(r.getResponse().getStatus()).as(r.getResponse().getContentAsString()).isEqualTo(200);return data(r);
    }
    @Test void privateContactsRequireSpecificSellerApproval() throws Exception {
        String seller=register(),buyer=register(),other=register(); String pid=listing(seller,false);
        assertThat(product(pid,buyer).path("contact").asText()).isEmpty();
        assertThat(product(pid,seller).path("contact").asText()).isEqualTo("wechat:seller");
        MvcResult submitted=postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of());
        assertThat(submitted.getResponse().getStatus()).as(submitted.getResponse().getContentAsString()).isEqualTo(200);
        String rid=data(submitted).path("id").asText();
        assertThat(data(postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of())).path("id").asText()).isEqualTo(rid);
        assertThat(postAs("/v1/contact-requests/"+rid+"/decision",buyer,Map.of("status","APPROVED")).getResponse().getStatus()).isEqualTo(404);
        assertThat(postAs("/v1/contact-requests/"+rid+"/decision",other,Map.of("status","APPROVED")).getResponse().getStatus()).isEqualTo(404);
        assertThat(product(pid,buyer).path("contact").asText()).isEmpty();
        assertThat(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED")).getResponse().getStatus()).isEqualTo(200);
        assertThat(product(pid,buyer).path("contact").asText()).isEqualTo("wechat:seller");
        assertThat(product(pid,other).path("contact").asText()).isEmpty();
        assertThat(product(listing(seller,false),buyer).path("contact").asText()).isEmpty();
        assertThat(product(pid,buyer).path("status").asText()).isEqualTo("在售");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM orders WHERE product_id=?",Integer.class,UUID.fromString(pid))).isZero();
        JsonNode requests=data(mvc.perform(get("/v1/contact-requests").header("Authorization","Bearer "+seller)).andReturn()).path("items");
        assertThat(requests).hasSize(1); assertThat(requests.get(0).path("productTitle").asText()).isEqualTo("联系方式测试");
        assertThat(requests.get(0).has("contact")).isFalse();
        assertThat(requests.toString()).doesNotContain("wechat:seller");
    }
    @Test void publicChoiceCanBeTurnedOffAndRejectedContactsStayPrivate() throws Exception {
        String seller=register(),buyer=register();String pid=listing(seller,true);
        assertThat(product(pid,buyer).path("contact").asText()).isEqualTo("wechat:seller");
        assertThat(postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of()).getResponse().getStatus()).isEqualTo(409);
        MvcResult updated=mvc.perform(patch("/v1/products/"+pid).header("Authorization","Bearer "+seller).contentType(MediaType.APPLICATION_JSON).content("{\"contactPublic\":false}")).andReturn();
        assertThat(updated.getResponse().getStatus()).as(updated.getResponse().getContentAsString()).isEqualTo(200);
        assertThat(product(pid,buyer).path("contact").asText()).isEmpty();
        String rid=data(postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of())).path("id").asText();
        assertThat(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","REJECTED")).getResponse().getStatus()).isEqualTo(200);
        assertThat(product(pid,buyer).path("contact").asText()).isEmpty();
        assertThat(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED")).getResponse().getStatus()).isEqualTo(409);
        assertThat(postAs("/v1/products/"+pid+"/contact-request",seller,Map.of()).getResponse().getStatus()).isEqualTo(400);
        assertThat(mvc.perform(get("/v1/products/"+pid)).andReturn().getResponse().getStatus()).isEqualTo(401);
    }
    @Test void retiredTradeAndMeetingRoutesAreUnavailable() throws Exception {
        String token=register();
        for(String path:List.of("/v1/orders","/v1/meeting-points","/v1/me/trade-history","/v1/users/"+UUID.randomUUID()+"/trade-summary")) {
            int status=mvc.perform(get(path).header("Authorization","Bearer "+token)).andReturn().getResponse().getStatus();
            assertThat(status).as(path).isEqualTo(404);
        }
    }

    // ================= 阶段 1：撤回、撤回同意、拒绝终态、未知字段、分页、未读、限流、数据库守卫 =================

    private MvcResult getAs(String path,String token) throws Exception { return mvc.perform(get(path).header("Authorization","Bearer "+token)).andReturn(); }
    private int status(MvcResult r) { return r.getResponse().getStatus(); }
    private String request(String pid,String buyer) throws Exception {
        MvcResult r=postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of());
        assertThat(status(r)).as(r.getResponse().getContentAsString()).isEqualTo(200);return data(r).path("id").asText();
    }
    private JsonNode unread(String token) throws Exception { return data(getAs("/v1/contact-requests/unread-count",token)); }

    @Test void buyerCanWithdrawAndReapplyWhileSellerSeesTheCurrentState() throws Exception {
        String seller=register(),buyer=register(),other=register(); String pid=listing(seller,false);
        String rid=request(pid,buyer);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/withdraw",seller,Map.of()))).as("只有买家能撤回").isEqualTo(404);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/withdraw",other,Map.of()))).isEqualTo(404);
        JsonNode withdrawn=data(postAs("/v1/contact-requests/"+rid+"/withdraw",buyer,Map.of()));
        assertThat(withdrawn.path("status").asText()).isEqualTo("WITHDRAWN");
        assertThat(data(postAs("/v1/contact-requests/"+rid+"/withdraw",buyer,Map.of())).path("status").asText()).as("重复撤回幂等").isEqualTo("WITHDRAWN");
        MvcResult late=postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED"));
        assertThat(status(late)).isEqualTo(409);
        assertThat(json.readTree(late.getResponse().getContentAsString()).path("message").asText()).isEqualTo("买家已撤回这次申请");
        assertThat(unread(seller).path("received").asLong()).as("撤回后不再算卖家未读").isZero();
        assertThat(product(pid,buyer).path("contact").asText()).isEmpty();
        assertThat(request(pid,buyer)).as("重新申请沿用同一条记录").isEqualTo(rid);
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid",String.class,rid)).isEqualTo("PENDING");
        assertThat(unread(seller).path("received").asLong()).isEqualTo(1);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED")))).isEqualTo(200);
        assertThat(product(pid,buyer).path("contact").asText()).isEqualTo("wechat:seller");
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/withdraw",buyer,Map.of()))).as("已同意的申请不能撤回").isEqualTo(409);
    }

    @Test void sellerCanRevokeApprovalAndRejectedOrRevokedRequestsAreFinal() throws Exception {
        String seller=register(),buyer=register(),rejected=register(); String pid=listing(seller,false);
        String rid=request(pid,buyer);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/revoke",seller,Map.of()))).as("待处理的申请没有可撤回的同意").isEqualTo(409);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED")))).isEqualTo(200);
        assertThat(product(pid,buyer).path("contact").asText()).isEqualTo("wechat:seller");
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/revoke",buyer,Map.of()))).as("只有卖家能撤回同意").isEqualTo(404);
        JsonNode revoked=data(postAs("/v1/contact-requests/"+rid+"/revoke",seller,Map.of()));
        assertThat(revoked.path("status").asText()).isEqualTo("REVOKED");
        assertThat(revoked.path("decidedAt").asLong()).isPositive();
        assertThat(product(pid,buyer).path("contact").asText()).as("撤回同意后立即看不到联系方式").isEmpty();
        assertThat(data(postAs("/v1/contact-requests/"+rid+"/revoke",seller,Map.of())).path("status").asText()).as("重复撤回幂等").isEqualTo("REVOKED");
        MvcResult again=postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of());
        assertThat(status(again)).isEqualTo(409);
        assertThat(json.readTree(again.getResponse().getContentAsString()).path("message").asText()).isEqualTo("卖家已撤回同意，不能再次申请");
        String rejectedId=request(pid,rejected);
        assertThat(status(postAs("/v1/contact-requests/"+rejectedId+"/decision",seller,Map.of("status","REJECTED")))).isEqualTo(200);
        MvcResult retry=postAs("/v1/products/"+pid+"/contact-request",rejected,Map.of());
        assertThat(status(retry)).as("被拒绝后再次申请不再静默成功").isEqualTo(409);
        assertThat(json.readTree(retry.getResponse().getContentAsString()).path("message").asText()).isEqualTo("卖家已拒绝这次申请，不能再次申请");
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid",String.class,rejectedId)).isEqualTo("REJECTED");
    }

    @Test void unknownFieldsAndQueryParametersAreRejectedWithoutSideEffects() throws Exception {
        String seller=register(),buyer=register(); String pid=listing(seller,false);
        MvcResult forged=postAs("/v1/products/"+pid+"/contact-request",buyer,Map.of("buyerId",UUID.randomUUID().toString(),"status","APPROVED"));
        assertThat(status(forged)).isEqualTo(400);
        assertThat(forged.getResponse().getContentAsString()).contains("buyerId").contains("status");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM contact_requests WHERE product_id=?::uuid",Long.class,pid)).isZero();
        String rid=request(pid,buyer);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/withdraw",buyer,Map.of("reason","x")))).isEqualTo(400);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/revoke",seller,Map.of("status","REVOKED")))).isEqualTo(400);
        assertThat(status(postAs("/v1/contact-requests/read",seller,Map.of("role","received","all",true)))).isEqualTo(400);
        assertThat(status(postAs("/v1/contact-requests/read",seller,Map.of("role","everything")))).isEqualTo(400);
        assertThat(status(getAs("/v1/contact-requests?sellerId="+UUID.randomUUID(),seller))).isEqualTo(400);
        assertThat(status(getAs("/v1/contact-requests?role=admin",seller))).isEqualTo(400);
        assertThat(status(getAs("/v1/contact-requests?status=DONE",seller))).isEqualTo(400);
        assertThat(status(getAs("/v1/contact-requests?size=51",seller))).isEqualTo(400);
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid",String.class,rid)).isEqualTo("PENDING");
    }

    @Test void listsArePagedPerRoleAndFilterable() throws Exception {
        String seller=register(); List<String> buyers=new ArrayList<>(); List<String> ids=new ArrayList<>();
        for(int i=0;i<3;i++){ String b=register(); buyers.add(b); ids.add(request(listing(seller,false),b)); }
        assertThat(status(postAs("/v1/contact-requests/"+ids.get(0)+"/decision",seller,Map.of("status","APPROVED")))).isEqualTo(200);
        JsonNode first=data(getAs("/v1/contact-requests?role=received&size=2",seller));
        assertThat(first.path("total").asLong()).isEqualTo(3);
        assertThat(first.path("items")).hasSize(2);
        assertThat(first.path("page").asInt()).isEqualTo(1);
        JsonNode second=data(getAs("/v1/contact-requests?role=received&size=2&page=2",seller));
        assertThat(second.path("items")).hasSize(1);
        List<String> seen=new ArrayList<>(first.path("items").findValuesAsText("id")); seen.addAll(second.path("items").findValuesAsText("id"));
        assertThat(seen).as("两页合起来恰好是全部、不重复").containsExactlyInAnyOrderElementsOf(ids);
        assertThat(first.path("items").get(0).path("id").asText()).as("最近有变化的排在前面").isEqualTo(ids.get(0));
        JsonNode pending=data(getAs("/v1/contact-requests?role=received&status=PENDING",seller));
        assertThat(pending.path("total").asLong()).isEqualTo(2);
        assertThat(pending.path("items").findValuesAsText("status")).containsOnly("PENDING");
        JsonNode sent=data(getAs("/v1/contact-requests?role=sent",buyers.get(1)));
        assertThat(sent.path("items").findValuesAsText("id")).containsExactly(ids.get(1));
        assertThat(sent.path("items").get(0).path("sellerNickname").asText()).isNotBlank();
        assertThat(data(getAs("/v1/contact-requests?role=received",buyers.get(1))).path("total").asLong()).as("买家没有收到的申请").isZero();
        assertThat(data(getAs("/v1/contact-requests",seller)).path("total").asLong()).as("默认是收到的申请").isEqualTo(3);
    }

    @Test void unreadCountsFollowNewRequestsAndDecisionsUntilMarkedRead() throws Exception {
        String seller=register(),buyer=register(); String pid=listing(seller,false);
        assertThat(unread(seller).path("total").asLong()).isZero();
        String rid=request(pid,buyer);
        assertThat(unread(seller).path("received").asLong()).isEqualTo(1);
        assertThat(unread(buyer).path("total").asLong()).as("买家刚发出的申请不算未读").isZero();
        JsonNode item=data(getAs("/v1/contact-requests?role=received",seller)).path("items").get(0);
        assertThat(item.path("unread").asBoolean()).isTrue();
        assertThat(unread(seller).path("received").asLong()).as("只看列表不会标记已读").isEqualTo(1);
        assertThat(data(postAs("/v1/contact-requests/read",seller,Map.of("role","received"))).path("received").asLong()).isZero();
        assertThat(data(getAs("/v1/contact-requests?role=received",seller)).path("items").get(0).path("unread").asBoolean()).isFalse();
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","APPROVED")))).isEqualTo(200);
        assertThat(unread(buyer).path("updates").asLong()).as("买家收到同意的结果").isEqualTo(1);
        assertThat(data(getAs("/v1/contact-requests?role=sent",buyer)).path("items").get(0).path("unread").asBoolean()).isTrue();
        assertThat(data(postAs("/v1/contact-requests/read",buyer,Map.of("role","sent"))).path("updates").asLong()).isZero();
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/revoke",seller,Map.of()))).isEqualTo(200);
        assertThat(unread(buyer).path("updates").asLong()).as("撤回同意也会通知买家").isEqualTo(1);
        assertThat(unread(seller).path("total").asLong()).isZero();
        assertThat(mvc.perform(get("/v1/contact-requests/unread-count")).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test void newRequestsAreRateLimitedPerUserButIdempotentRepeatsAreFree() throws Exception {
        String seller=register(),buyer=register();
        List<String> pids=new ArrayList<>();
        for(int i=0;i<6;i++) pids.add(listing(seller,false));
        for(int i=0;i<5;i++){
            request(pids.get(i),buyer);
            request(pids.get(i),buyer); // 对同一件商品的重复请求幂等返回，不计数
        }
        MvcResult limited=postAs("/v1/products/"+pids.get(5)+"/contact-request",buyer,Map.of());
        assertThat(status(limited)).isEqualTo(429);
        assertThat(limited.getResponse().getHeader("Retry-After")).isNotNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM contact_requests WHERE buyer_id=(SELECT buyer_id FROM contact_requests WHERE product_id=?::uuid)",Long.class,pids.get(0))).isEqualTo(5);
        String other=register();
        assertThat(request(pids.get(5),other)).as("限流按用户计，不影响别人").isNotBlank();
    }

    private String userId(String token) throws Exception { return data(getAs("/v1/auth/me",token)).path("id").asText(); }
    private long contactRateCount() { return jdbc.queryForObject("SELECT coalesce(sum(request_count),0) FROM rate_limit_counters WHERE scope='contact_request'",Long.class); }
    /** 工作人员按正常流程（举报 → 案件 → 决定）给用户施加「申请联系方式」限制。 */
    private void restrictContact(String target) throws Exception {
        String staff=register(),reporter=register(),targetId=userId(target);
        jdbc.update("INSERT INTO staff_members(user_id, school_id, role) VALUES (?::uuid, 'pilot', 'MODERATOR')",userId(staff));
        assertThat(status(postAs("/v1/moderation-reports",reporter,Map.of("targetType","USER","targetId",targetId,"reasonCode","HARASSMENT")))).isEqualTo(200);
        String caseId=jdbc.queryForObject("SELECT id::text FROM moderation_cases WHERE target_type='USER' AND target_id=?::uuid ORDER BY created_at DESC LIMIT 1",String.class,targetId);
        MvcResult decided=postAs("/v1/moderation/cases/"+caseId+"/decision",staff,Map.of("action","RESTRICT_CONTACT","reasonCode","HARASSMENT","durationHours",24));
        assertThat(status(decided)).as(decided.getResponse().getContentAsString()).isEqualTo(200);
    }

    /**
     * 幂等在限制之前：已有 PENDING / APPROVED 申请时，受「申请联系方式」限制的买家重复提交仍返回原申请（200、内容不变、不计入限流）；
     * 只有新申请与撤回后的重新申请（WITHDRAWN → PENDING）被限制拦下（403，什么都不写）。
     */
    @Test void existingRequestsStayIdempotentWhileContactIsRestrictedButNewOnesAreBlocked() throws Exception {
        String seller=register(),buyer=register();
        String pendingProduct=listing(seller,false),approvedProduct=listing(seller,false),withdrawnProduct=listing(seller,false),
            rejectedProduct=listing(seller,false),freshProduct=listing(seller,false);
        String pending=request(pendingProduct,buyer),approved=request(approvedProduct,buyer),withdrawn=request(withdrawnProduct,buyer),rejected=request(rejectedProduct,buyer);
        assertThat(status(postAs("/v1/contact-requests/"+approved+"/decision",seller,Map.of("status","APPROVED")))).isEqualTo(200);
        assertThat(status(postAs("/v1/contact-requests/"+rejected+"/decision",seller,Map.of("status","REJECTED")))).isEqualTo(200);
        assertThat(status(postAs("/v1/contact-requests/"+withdrawn+"/withdraw",buyer,Map.of()))).isEqualTo(200);
        JsonNode pendingBefore=data(getAs("/v1/products/"+pendingProduct+"/contact-request",buyer));
        JsonNode approvedBefore=data(getAs("/v1/products/"+approvedProduct+"/contact-request",buyer));
        restrictContact(buyer);

        long counted=contactRateCount();
        // 买家在这个类里每小时最多 5 次；已经用了 4 次，重复 6 次仍全部成功——说明重放不计数
        for(int i=0;i<3;i++){
            MvcResult again=postAs("/v1/products/"+pendingProduct+"/contact-request",buyer,Map.of());
            assertThat(status(again)).as(again.getResponse().getContentAsString()).isEqualTo(200);
            assertThat(data(again)).as("PENDING 原样返回").isEqualTo(pendingBefore);
            MvcResult approvedAgain=postAs("/v1/products/"+approvedProduct+"/contact-request",buyer,Map.of());
            assertThat(status(approvedAgain)).isEqualTo(200);
            assertThat(data(approvedAgain)).as("APPROVED 原样返回").isEqualTo(approvedBefore);
        }
        assertThat(contactRateCount()).as("幂等重放不计入限流").isEqualTo(counted);
        assertThat(product(approvedProduct,buyer).path("contact").asText()).as("已同意的联系方式照常可见").isEqualTo("wechat:seller");

        MvcResult fresh=postAs("/v1/products/"+freshProduct+"/contact-request",buyer,Map.of());
        assertThat(status(fresh)).as("新申请被限制拦下").isEqualTo(403);
        assertThat(json.readTree(fresh.getResponse().getContentAsString()).path("data").path("scope").asText()).isEqualTo("CONTACT");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM contact_requests WHERE product_id=?::uuid",Long.class,freshProduct)).isZero();
        MvcResult reapply=postAs("/v1/products/"+withdrawnProduct+"/contact-request",buyer,Map.of());
        assertThat(status(reapply)).as("撤回后的重新申请同样被拦下").isEqualTo(403);
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid",String.class,withdrawn)).isEqualTo("WITHDRAWN");
        assertThat(status(postAs("/v1/products/"+rejectedProduct+"/contact-request",buyer,Map.of()))).as("已拒绝的申请不是幂等重放：受限期间同样 403").isEqualTo(403);
        assertThat(contactRateCount()).as("被拦下的请求也不计数").isEqualTo(counted);
        assertThat(jdbc.queryForList("SELECT status FROM contact_requests WHERE id IN (?::uuid,?::uuid,?::uuid) ORDER BY created_at",String.class,pending,approved,rejected))
            .containsExactly("PENDING","APPROVED","REJECTED");

        String other=register();
        assertThat(request(freshProduct,other)).as("限制只针对这位买家").isNotBlank();
    }

    @Test void databaseGuardsTheStateMachineEvenForDirectWrites() throws Exception {
        String seller=register(),buyer=register(); String pid=listing(seller,false);
        String sellerId=jdbc.queryForObject("SELECT seller_id::text FROM products WHERE id=?::uuid",String.class,pid);
        String buyerId=data(mvc.perform(get("/v1/auth/me").header("Authorization","Bearer "+buyer)).andReturn()).path("id").asText();
        assertThatThrownBy(() -> jdbc.update("INSERT INTO contact_requests(id,product_id,buyer_id,seller_id,status,decided_at) VALUES (gen_random_uuid(),?::uuid,?::uuid,?::uuid,'APPROVED',now())",
                pid,buyerId,sellerId)).as("只能以 PENDING 开始").isInstanceOf(org.springframework.dao.DataAccessException.class);
        String rid=request(pid,buyer);
        assertThat(status(postAs("/v1/contact-requests/"+rid+"/decision",seller,Map.of("status","REJECTED")))).isEqualTo(200);
        for(String sql:List.of("UPDATE contact_requests SET status='APPROVED' WHERE id=?::uuid","UPDATE contact_requests SET status='PENDING', decided_at=NULL WHERE id=?::uuid",
                "UPDATE contact_requests SET buyer_id=seller_id WHERE id=?::uuid","DELETE FROM contact_requests WHERE id=?::uuid")) {
            assertThatThrownBy(() -> jdbc.update(sql,rid)).as(sql).isInstanceOf(org.springframework.dao.DataAccessException.class);
        }
        assertThat(jdbc.queryForObject("SELECT status FROM contact_requests WHERE id=?::uuid",String.class,rid)).isEqualTo("REJECTED");
    }
}
