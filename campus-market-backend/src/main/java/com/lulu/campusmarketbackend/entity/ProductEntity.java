package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.lulu.campusmarketbackend.mapper.JsonbTypeHandler;
import lombok.Data;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Data
@TableName(value = "products", autoResultMap = true)
public class ProductEntity {
    @TableId private UUID id;
    private UUID sellerId;
    private String title;
    private String description;
    private BigDecimal price;
    private String category;
    private String condition;
    private String campus;
    @TableField(typeHandler = JsonbTypeHandler.class) private List<String> images;
    private String contact;
    private BigDecimal originalPrice;
    private String status;
    private Integer views;
    private OffsetDateTime createdAt;
    private OffsetDateTime soldAt;
}
