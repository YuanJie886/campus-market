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
    /** 取货楼栋。可空：公共地点发布与旧商品都没有楼栋。 */
    private String buildingId;
    @TableField(typeHandler = JsonbTypeHandler.class) private List<String> images;
    private String contact;
    private Boolean contactPublic;
    private BigDecimal originalPrice;
    private String status;
    private Integer views;
    private OffsetDateTime createdAt;
    private OffsetDateTime soldAt;
    /** 模块 5：SINGLE（单件）/ BUNDLE（整套打包）。旧商品默认 SINGLE */
    private String listingKind;
    /** 模块 5：最终点击发布的人，必须是所有者 */
    private UUID publishedBy;
    /** 模块 5：可选，协助整理内容的人（只做记录，不授予任何权限） */
    private UUID assistedBy;
    /** 模块 6：PUBLIC / CIRCLE_ONLY */
    private String visibility;
}
