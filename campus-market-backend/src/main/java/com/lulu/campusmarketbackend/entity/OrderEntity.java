package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("orders")
public class OrderEntity {
    @TableId private UUID id;
    private UUID productId;
    private UUID buyerId;
    private UUID sellerId;
    private BigDecimal price;
    /** 模块 5：下单时写入的成交价快照（之后不可修改）；旧订单为 null，不补写 */
    private BigDecimal priceSnapshot;
    private String currency;
    /** V8：下单瞬间冻结的统计维度（学校、分类、成色、形态、教材版本），之后不可修改 */
    private String schoolIdSnapshot;
    private String categorySnapshot;
    private String conditionSnapshot;
    private String listingKindSnapshot;
    private String textbookEditionIdSnapshot;
    /** V9：下单瞬间商品是否仅圈子可见（公开价格参考据此排除圈子商品） */
    private String visibilitySnapshot;
    private String status;
    private String meetingPointId;
    private OffsetDateTime meetingAt;
    /** 7.1A：新预约保存明确的结束时间；V11 之前的旧订单为 null，不补写 */
    private OffsetDateTime meetingEndsAt;
    private String contact;
    private String confirmationCode;
    private Integer codeAttempts;
    private String idempotencyKey;
    private String requestHash;
    private OffsetDateTime expiresAt;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
