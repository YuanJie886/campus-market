package com.lulu.campusmarketbackend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

class DomainMapperTest {
    @Test
    void orderResponseIncludesItsConversationId() {
        DomainMapper mapper = new DomainMapper(new ObjectMapper());
        UUID conversationId = UUID.randomUUID();
        Timestamp timestamp = Timestamp.from(Instant.parse("2026-09-23T00:00:00Z"));
        Map<String, Object> row = Map.ofEntries(
                Map.entry("id", UUID.randomUUID()),
                Map.entry("product_id", UUID.randomUUID()),
                Map.entry("buyer_id", UUID.randomUUID()),
                Map.entry("seller_id", UUID.randomUUID()),
                Map.entry("conversation_id", conversationId),
                Map.entry("price", new BigDecimal("12.50")),
                Map.entry("status", "PENDING_SELLER_CONFIRM"),
                Map.entry("meeting_point_id", "east-library"),
                Map.entry("meeting_at", timestamp),
                Map.entry("contact", "buyer-contact"),
                Map.entry("confirmation_code", "123456"),
                Map.entry("expires_at", timestamp),
                Map.entry("created_at", timestamp),
                Map.entry("updated_at", timestamp)
        );

        Map<String, Object> order = mapper.order(row, String.valueOf(row.get("buyer_id")), List.of());

        assertEquals(conversationId.toString(), order.get("conversationId"));
    }
}
