package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.*;
import java.util.*;

@Mapper
public interface ContactRequestMapper {
    @Select("SELECT * FROM contact_requests WHERE id=#{id} FOR UPDATE")
    Map<String,Object> lock(@Param("id") UUID id);
    @Select("SELECT * FROM contact_requests WHERE product_id=#{pid} AND buyer_id=#{buyer}")
    Map<String,Object> find(@Param("pid") UUID pid, @Param("buyer") UUID buyer);
    @Insert("INSERT INTO contact_requests(id,product_id,buyer_id,seller_id) VALUES(#{id},#{pid},#{buyer},#{seller}) ON CONFLICT(product_id,buyer_id) DO NOTHING")
    int insert(@Param("id") UUID id, @Param("pid") UUID pid, @Param("buyer") UUID buyer, @Param("seller") UUID seller);
    @Update("UPDATE contact_requests SET status=#{status},updated_at=now() WHERE id=#{id}")
    int decide(@Param("id") UUID id, @Param("status") String status);
    @Select("SELECT r.*,p.title AS product_title,u.nickname AS buyer_nickname FROM contact_requests r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.buyer_id WHERE (r.buyer_id=#{uid} OR r.seller_id=#{uid}) AND product_visible_to(p.id,p.visibility,p.seller_id,p.campus,p.moderation_hidden_at,#{uid}) ORDER BY r.created_at DESC")
    List<Map<String,Object>> list(@Param("uid") UUID uid);
}
