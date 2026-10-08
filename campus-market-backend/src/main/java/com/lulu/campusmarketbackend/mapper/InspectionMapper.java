package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 验货模板、商品声明与订单验货快照的数据访问（模块 3）。
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

    // ---------------- 订单快照 ----------------

    /**
     * 下单时复制快照：一条 INSERT ... SELECT 把模板条目与卖家声明一起拷进订单，
     * 不读回 Java 再逐条写入，也就不存在 N+1。之后商品声明怎么改都与这份快照无关。
     */
    @Insert("""
            INSERT INTO order_inspection_items(order_id, item_code, label_snapshot, description_snapshot,
                required_snapshot, sort_order, seller_condition_snapshot, seller_note_snapshot)
            SELECT #{orderId}, t.code, t.label, t.description, t.required, t.sort_order,
                   d.declared_condition, COALESCE(d.note, '')
            FROM inspection_template_items t
            LEFT JOIN product_inspection_disclosures d
                   ON d.product_id = #{productId} AND d.template_id = t.template_id AND d.item_code = t.code
            WHERE t.template_id = #{templateId}
            """)
    int copySnapshotItems(@Param("orderId") UUID orderId, @Param("productId") UUID productId,
                          @Param("templateId") String templateId);

    @Insert("""
            INSERT INTO order_inspections(order_id, template_id, template_title_snapshot, template_version, status)
            VALUES (#{orderId}, #{templateId}, #{title}, #{version}, #{status})
            """)
    int insertInspection(@Param("orderId") UUID orderId, @Param("templateId") String templateId,
                         @Param("title") String title, @Param("version") Integer version,
                         @Param("status") String status);

    @Select("SELECT order_id, template_id, template_title_snapshot, template_version, status, has_mismatch, "
            + "submitted_at, submitted_by FROM order_inspections WHERE order_id = #{orderId}")
    Map<String, Object> selectInspection(@Param("orderId") UUID orderId);

    @Select("SELECT order_id, status, has_mismatch FROM order_inspections WHERE order_id = #{orderId} FOR UPDATE")
    Map<String, Object> selectInspectionForUpdate(@Param("orderId") UUID orderId);

    /** 一次取回订单全部条目（单条 SQL，无 N+1）。 */
    @Select("SELECT item_code, label_snapshot, description_snapshot, required_snapshot, sort_order, "
            + "seller_condition_snapshot, seller_note_snapshot, buyer_result, buyer_note, checked_at "
            + "FROM order_inspection_items WHERE order_id = #{orderId} ORDER BY sort_order, item_code")
    List<Map<String, Object>> selectInspectionItems(@Param("orderId") UUID orderId);

    /** 保存买家结果（草稿或最终）。触发器保证已提交的记录不会被这里改动。 */
    @Update("""
            <script>
            UPDATE order_inspection_items AS i SET
                buyer_result = v.result,
                buyer_note = v.note,
                checked_at = CASE WHEN #{finalSubmit} THEN now() ELSE NULL END
            FROM (VALUES
            <foreach collection="items" item="r" separator=",">
                (#{r.code}::text, #{r.result}::text, #{r.note}::text)
            </foreach>
            ) AS v(code, result, note)
            WHERE i.order_id = #{orderId} AND i.item_code = v.code
            </script>
            """)
    int updateBuyerResults(@Param("orderId") UUID orderId, @Param("items") List<ResultRow> items,
                           @Param("finalSubmit") boolean finalSubmit);

    record ResultRow(String code, String result, String note) {}

    @Update("""
            UPDATE order_inspections SET status = #{status}, has_mismatch = #{hasMismatch},
                submitted_at = now(), submitted_by = #{buyerId}
            WHERE order_id = #{orderId} AND status = 'PENDING'
            """)
    int markSubmitted(@Param("orderId") UUID orderId, @Param("status") String status,
                      @Param("hasMismatch") boolean hasMismatch, @Param("buyerId") UUID buyerId);

    // ---------------- 模块 5 ----------------

    /** 全部启用模板的条目（带分类），批量校验一次取回。 */
    @Select("SELECT t.category, t.id AS template_id, i.code, i.required FROM inspection_templates t "
            + "JOIN inspection_template_items i ON i.template_id = t.id WHERE t.active ORDER BY t.category, i.sort_order")
    List<Map<String, Object>> selectActiveTemplateItemsAll();

    @Select("SELECT listing_kind FROM products WHERE id = #{productId}")
    String selectListingKind(@Param("productId") UUID productId);

    /**
     * 整套打包的订单验货快照：每条明细一项基础检查。检查要点按明细的分类取当前模板的必填条目，
     * 写进说明快照（例如数码电子 → 能正常开机、屏幕显示正常……）。买家可以逐条标记不一致，
     * 任一不一致照旧进入 DISPUTED。一条语句完成，与明细数量无关。
     */
    @Insert("""
            INSERT INTO order_inspection_items(order_id, item_code, label_snapshot, description_snapshot,
                required_snapshot, sort_order, seller_condition_snapshot, seller_note_snapshot)
            SELECT #{orderId}, 'B' || lpad((b.sort_order + 1)::text, 2, '0') || '_' || b.item_code,
                   b.name || ' ×' || b.quantity,
                   '分类：' || b.category || '；卖家标注成色：' || b.condition
                     || COALESCE('；核对要点：' || (
                          SELECT string_agg(ti.label, '、' ORDER BY ti.sort_order)
                          FROM inspection_templates t JOIN inspection_template_items ti ON ti.template_id = t.id
                          WHERE t.category = b.category AND t.active AND ti.required), ''),
                   true, b.sort_order, NULL, b.note
            FROM bundle_items b WHERE b.product_id = #{productId}
            """)
    int copyBundleSnapshotItems(@Param("orderId") UUID orderId, @Param("productId") UUID productId);
}
