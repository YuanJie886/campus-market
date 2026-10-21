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
 * 课程教材图谱（模块 4）的数据访问。
 *
 * <p>每个读方法都以 school_id 作为条件：跨学校的 id 查不到任何行，服务层统一返回 404，
 * 不依赖前端过滤。刻意没有「谁订阅了这本教材」「谁提交了这条建议」之类的公开读路径。
 * 复杂 SQL 在 CatalogMapper.xml。
 */
@Mapper
public interface CatalogMapper {

    // ---------------- 课程 ----------------

    List<Map<String, Object>> selectCourses(@Param("schoolId") String schoolId, @Param("q") String q,
                                            @Param("codePrefix") String codePrefix, @Param("term") String term,
                                            @Param("academicYear") String academicYear, @Param("campus") String campus,
                                            @Param("limit") int limit, @Param("offset") int offset);

    long countCourses(@Param("schoolId") String schoolId, @Param("q") String q,
                      @Param("codePrefix") String codePrefix, @Param("term") String term,
                      @Param("academicYear") String academicYear, @Param("campus") String campus);

    @Select("SELECT id, course_code, name, department, is_demo FROM courses "
            + "WHERE id = #{courseId} AND school_id = #{schoolId} AND active")
    Map<String, Object> selectCourse(@Param("courseId") String courseId, @Param("schoolId") String schoolId);

    @Select("SELECT o.id, o.course_id, o.academic_year, o.term, o.instructor_name, o.campus_id "
            + "FROM course_offerings o WHERE o.course_id = #{courseId} AND o.active "
            + "ORDER BY o.academic_year DESC, "
            + "CASE o.term WHEN 'AUTUMN' THEN 0 WHEN 'SUMMER' THEN 1 WHEN 'SPRING' THEN 2 ELSE 3 END, o.id")
    List<Map<String, Object>> selectOfferingsByCourse(@Param("courseId") String courseId);

    @Select("SELECT o.id, o.course_id, o.academic_year, o.term, o.instructor_name, o.campus_id, "
            + "c.name AS course_name, c.course_code, c.is_demo "
            + "FROM course_offerings o JOIN courses c ON c.id = o.course_id AND c.active "
            + "WHERE o.id = #{offeringId} AND o.school_id = #{schoolId} AND o.active")
    Map<String, Object> selectOffering(@Param("offeringId") String offeringId, @Param("schoolId") String schoolId);

    /** 课程（或单个开课）的已验证教材，每本带当前在售数量。一条 SQL，与教材数量无关。 */
    List<Map<String, Object>> selectVerifiedTextbooks(@Param("courseId") String courseId,
                                                      @Param("offeringId") String offeringId,
                                                      @Param("viewerId") java.util.UUID viewerId);

    // ---------------- 教材版本 ----------------

    @Select("SELECT * FROM textbook_editions WHERE id = #{editionId} AND school_id = #{schoolId} AND active")
    Map<String, Object> selectEdition(@Param("editionId") String editionId, @Param("schoolId") String schoolId);

    @Select("SELECT * FROM textbook_editions WHERE normalized_isbn = #{isbn13} AND school_id = #{schoolId} AND active")
    Map<String, Object> selectEditionByIsbn(@Param("isbn13") String isbn13, @Param("schoolId") String schoolId);

    /** 教材版本被哪些开课使用（只取 VERIFIED）。 */
    List<Map<String, Object>> selectEditionCourses(@Param("editionId") String editionId, @Param("schoolId") String schoolId);

    /** 同一部教材的其他版次（人工整理的 work_key 分组，不按书名推断），带在售数量。 */
    List<Map<String, Object>> selectOtherEditions(@Param("schoolId") String schoolId, @Param("workKey") String workKey,
                                                  @Param("excludeId") String excludeId,
                                                  @Param("viewerId") java.util.UUID viewerId);

    long countOnSale(@Param("editionId") String editionId, @Param("viewerId") java.util.UUID viewerId);

    // ---------------- 商品 ↔ 教材版本 ----------------

    @Select("SELECT * FROM product_textbook_details WHERE product_id = #{productId}")
    Map<String, Object> selectProductTextbook(@Param("productId") UUID productId);

    /**
     * 关联或换绑。版本不变时什么都不改（快照保持卖家当初确认时的样子）；
     * 版本变化时整体替换快照。
     */
    @Insert("""
            INSERT INTO product_textbook_details(product_id, school_id, textbook_edition_id,
                isbn_snapshot, title_snapshot, edition_snapshot, publisher_snapshot)
            VALUES (#{productId}, #{schoolId}, #{editionId}, #{isbn}, #{title}, #{edition}, #{publisher})
            ON CONFLICT (product_id) DO UPDATE SET
                school_id = EXCLUDED.school_id, textbook_edition_id = EXCLUDED.textbook_edition_id,
                isbn_snapshot = EXCLUDED.isbn_snapshot, title_snapshot = EXCLUDED.title_snapshot,
                edition_snapshot = EXCLUDED.edition_snapshot, publisher_snapshot = EXCLUDED.publisher_snapshot,
                updated_at = now()
            WHERE product_textbook_details.textbook_edition_id <> EXCLUDED.textbook_edition_id
            """)
    int linkProductTextbook(@Param("productId") UUID productId, @Param("schoolId") String schoolId,
                            @Param("editionId") String editionId, @Param("isbn") String isbn,
                            @Param("title") String title, @Param("edition") String edition,
                            @Param("publisher") String publisher);

    @Delete("DELETE FROM product_textbook_details WHERE product_id = #{productId}")
    int unlinkProductTextbook(@Param("productId") UUID productId);

    // ---------------- 教材建议 ----------------

    @Select("SELECT id FROM textbook_suggestions WHERE submitter_id = #{submitterId} "
            + "AND fingerprint = #{fingerprint} AND status = 'PENDING'")
    UUID selectPendingSuggestion(@Param("submitterId") UUID submitterId, @Param("fingerprint") String fingerprint);

    @Insert("""
            INSERT INTO textbook_suggestions(id, submitter_id, school_id, course_offering_id, textbook_edition_id,
                isbn13, title, authors, publisher, edition_label, published_year, usage_type, note, fingerprint)
            VALUES (#{id}, #{submitterId}, #{schoolId}, #{offeringId}, #{editionId},
                #{isbn13}, #{title}, #{authors}, #{publisher}, #{editionLabel}, #{year}, #{usageType}, #{note}, #{fingerprint})
            ON CONFLICT (submitter_id, fingerprint) WHERE status = 'PENDING' DO NOTHING
            """)
    int insertSuggestion(@Param("id") UUID id, @Param("submitterId") UUID submitterId, @Param("schoolId") String schoolId,
                         @Param("offeringId") String offeringId, @Param("editionId") String editionId,
                         @Param("isbn13") String isbn13, @Param("title") String title, @Param("authors") String authors,
                         @Param("publisher") String publisher, @Param("editionLabel") String editionLabel,
                         @Param("year") Integer year, @Param("usageType") String usageType, @Param("note") String note,
                         @Param("fingerprint") String fingerprint);

    /** 本人的建议。只有提交人自己能读到，且不含 submitter_id。 */
    @Select("""
            SELECT s.id, s.course_offering_id, s.textbook_edition_id, s.isbn13, s.title, s.authors, s.publisher,
                   s.edition_label, s.published_year, s.usage_type, s.note, s.status, s.created_at, s.withdrawn_at,
                   c.name AS course_name, o.academic_year, o.term, e.title AS edition_title, e.edition_label AS edition_edition_label
            FROM textbook_suggestions s
            JOIN course_offerings o ON o.id = s.course_offering_id
            JOIN courses c ON c.id = o.course_id
            LEFT JOIN textbook_editions e ON e.id = s.textbook_edition_id
            WHERE s.submitter_id = #{submitterId}
            ORDER BY s.created_at DESC, s.id
            """)
    List<Map<String, Object>> selectSuggestionsBySubmitter(@Param("submitterId") UUID submitterId);

    @Select("SELECT status FROM textbook_suggestions WHERE id = #{id} AND submitter_id = #{submitterId}")
    String selectOwnSuggestionStatus(@Param("id") UUID id, @Param("submitterId") UUID submitterId);

    @Update("UPDATE textbook_suggestions SET status = 'WITHDRAWN', withdrawn_at = now() "
            + "WHERE id = #{id} AND submitter_id = #{submitterId} AND status = 'PENDING'")
    int withdrawSuggestion(@Param("id") UUID id, @Param("submitterId") UUID submitterId);

    /** 模块 5：批量校验一次取回若干版本。 */
    @Select("""
            <script>
            SELECT * FROM textbook_editions WHERE school_id = #{schoolId} AND active AND id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            </script>
            """)
    List<Map<String, Object>> selectEditionsByIds(@Param("ids") List<String> ids, @Param("schoolId") String schoolId);
}
