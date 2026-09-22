package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.ProductEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.math.BigDecimal;

@Mapper
public interface ProductMapper extends BaseMapper<ProductEntity> {
    List<Map<String, Object>> selectProductRows(@Param("uid") UUID uid, @Param("category") String category,
                                                 @Param("campus") String campus, @Param("condition") String condition,
                                                 @Param("keyword") String keyword, @Param("minPrice") Object minPrice,
                                                 @Param("maxPrice") Object maxPrice, @Param("orderBy") String orderBy,
                                                 @Param("limit") int limit, @Param("offset") int offset);
    long countProductRows(@Param("uid") UUID uid, @Param("category") String category,
                           @Param("campus") String campus, @Param("condition") String condition,
                           @Param("keyword") String keyword, @Param("minPrice") Object minPrice,
                           @Param("maxPrice") Object maxPrice);
    @Select("SELECT * FROM products WHERE id=#{id}") Map<String, Object> selectRowById(@Param("id") UUID id);
    @Select("SELECT id FROM orders WHERE product_id=#{productId} AND (buyer_id=#{uid} OR seller_id=#{uid})") List<UUID> selectRelatedOrderIds(@Param("productId") UUID productId, @Param("uid") UUID uid);
    @Select("SELECT * FROM products WHERE id=#{id} FOR UPDATE") Map<String, Object> selectForUpdate(@Param("id") UUID id);
    @Update("UPDATE products SET views=views+1 WHERE id=#{id}") int incrementViews(@Param("id") UUID id);
    @Update("UPDATE products SET status='在售' WHERE id=#{id} AND status='预约中'") int releaseReservation(@Param("id") UUID id);
    @Update("UPDATE products SET status='已售出',sold_at=now() WHERE id=#{id}") int markSold(@Param("id") UUID id);
    int updateProductFields(@Param("id") UUID id, @Param("title") String title, @Param("titleSet") boolean titleSet,
                            @Param("description") String description, @Param("descriptionSet") boolean descriptionSet,
                            @Param("price") BigDecimal price, @Param("priceSet") boolean priceSet,
                            @Param("originalPrice") BigDecimal originalPrice, @Param("originalPriceSet") boolean originalPriceSet,
                            @Param("category") String category, @Param("categorySet") boolean categorySet,
                            @Param("condition") String condition, @Param("conditionSet") boolean conditionSet,
                            @Param("campus") String campus, @Param("campusSet") boolean campusSet,
                            @Param("images") List<String> images, @Param("imagesSet") boolean imagesSet,
                            @Param("contact") String contact, @Param("contactSet") boolean contactSet,
                            @Param("status") String status, @Param("statusSet") boolean statusSet,
                            @Param("soldAt") Object soldAt);
}
