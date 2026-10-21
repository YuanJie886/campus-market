package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 验货模板与商品声明的数据访问（模块 3；订单验货快照只作为历史保留，V16 起只读）。
 */
@Mapper
public interface InspectionMapper {

    // ---------------- 模板 ----------------

    /** 某分类当前启用的模板（每个分类至多一个，由部分唯一索引保证）。 */
    @Select("SELECT id, category, version, title FROM inspection_templates WHERE category = #{category} AND active")
    Map<String, Object> selectActiveTemplate(@Param("category") String category);

    @Select("SELECT id, category, version, title FROM inspection_templates WHERE id = #{id}")
    Map<String, Object> selectTemplate(@Param("id") String id);

    @Select("SELECT code, label, description, required, sort_order FROM inspection_template_items "
            + "WHERE template_id = #{templateId} ORDER BY sort_order, code")
    List<Map<String, Object>> selectTemplateItems(@Param("templateId") String templateId);

    // ---------------- 商品声明 ----------------

    @Select("SELECT template_id, item_code, declared_condition, note FROM product_inspection_disclosures "
            + "WHERE product_id = #{productId}")
    List<Map<String, Object>> selectDisclosures(@Param("productId") UUID productId);

    @Delete("DELETE FROM product_inspection_disclosures WHERE product_id = #{productId}")
    int deleteDisclosures(@Param("productId") UUID productId);

    /** 一次写入一件商品的全部声明（批量，无 N+1）。 */
    @Insert("""
            <script>
            INSERT INTO product_inspection_disclosures(product_id, template_id, item_code, declared_condition, note)
            VALUES
            <foreach collection="items" item="i" separator=",">
              (#{productId}, #{templateId}, #{i.code}, #{i.condition}, #{i.note})
            </foreach>
            </script>
            """)
    int insertDisclosures(@Param("productId") UUID productId, @Param("templateId") String templateId,
                          @Param("items") List<DisclosureRow> items);

    record DisclosureRow(String code, String condition, String note) {}

    // ---------------- 模块 5 ----------------

    /** 全部启用模板的条目（带分类），批量校验一次取回。 */
    @Select("SELECT t.category, t.id AS template_id, i.code, i.required FROM inspection_templates t "
            + "JOIN inspection_template_items i ON i.template_id = t.id WHERE t.active ORDER BY t.category, i.sort_order")
    List<Map<String, Object>> selectActiveTemplateItemsAll();
}
