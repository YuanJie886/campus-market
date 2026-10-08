package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 整套打包明细（模块 5）。明细没有 id，不是商品，不能被单独下单。 */
@Mapper
public interface BundleMapper {

    record ItemRow(String itemCode, String name, String category, String condition, int quantity, String note, int sortOrder) {}

    /** 一条语句写入全部明细（与明细数量无关）。 */
    @Insert("""
            <script>
            INSERT INTO bundle_items(product_id, item_code, name, category, condition, quantity, note, sort_order) VALUES
            <foreach collection="items" item="i" separator=",">
              (#{productId}, #{i.itemCode}, #{i.name}, #{i.category}, #{i.condition}, #{i.quantity}, #{i.note}, #{i.sortOrder})
            </foreach>
            </script>
            """)
    int insertItems(@Param("productId") UUID productId, @Param("items") List<ItemRow> items);

    @Delete("DELETE FROM bundle_items WHERE product_id = #{productId}")
    int deleteItems(@Param("productId") UUID productId);

    @Select("SELECT item_code, name, category, condition, quantity, note, sort_order FROM bundle_items "
            + "WHERE product_id = #{productId} ORDER BY sort_order")
    List<Map<String, Object>> selectItems(@Param("productId") UUID productId);
}
