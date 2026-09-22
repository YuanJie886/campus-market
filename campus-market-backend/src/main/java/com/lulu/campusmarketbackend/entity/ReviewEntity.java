package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("reviews")
public class ReviewEntity {
    @TableId private UUID id;
    private UUID orderId;
    private UUID reviewerId;
    private Integer rating;
    private String comment;
    private OffsetDateTime createdAt;
}
