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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Testcontainers
@SpringBootTest(properties={"spring.flyway.enabled=true","spring.flyway.baseline-on-migrate=false"})
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
        JsonNode requests=data(mvc.perform(get("/v1/contact-requests").header("Authorization","Bearer "+seller)).andReturn());
        assertThat(requests).hasSize(1); assertThat(requests.get(0).path("productTitle").asText()).isEqualTo("联系方式测试");
        assertThat(requests.get(0).has("contact")).isFalse();
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
}
