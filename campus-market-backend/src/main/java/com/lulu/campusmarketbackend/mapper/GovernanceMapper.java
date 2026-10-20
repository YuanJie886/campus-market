package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 模块 7：取消记录、爽约报告、平台工作人员、用户限制、举报 / 案件 / 动作 / 申诉。
 * 所有时间由数据库生成（clock_timestamp()），客户端无法提交。
 */
@Mapper
public interface GovernanceMapper {

    // ================= 工作人员（每次请求都从数据库读取） =================

    @Select("""
            SELECT s.user_id, s.school_id, s.role FROM staff_members s
            WHERE s.user_id = #{userId} AND s.active AND s.school_id = viewer_school(s.user_id)
            """)
    Map<String, Object> selectActiveStaff(@Param("userId") UUID userId);

    // ================= 7.1C 利益回避（判断在数据库函数里） =================

    @Select("SELECT staff_case_conflict(#{caseId}, #{staff})")
    String selectCaseConflict(@Param("caseId") UUID caseId, @Param("staff") UUID staff);

    @Select("SELECT staff_product_conflict(#{productId}, #{staff})")
    String selectProductConflict(@Param("productId") UUID productId, @Param("staff") UUID staff);

    @Select("SELECT staff_appeal_conflict(#{appealId}, #{staff})")
    String selectAppealConflict(@Param("appealId") UUID appealId, @Param("staff") UUID staff);

    @Select("SELECT eligible_staff_for_case(#{caseId})")
    int eligibleStaffForCase(@Param("caseId") UUID caseId);

    @Select("SELECT eligible_staff_for_appeal(#{appealId})")
    int eligibleStaffForAppeal(@Param("appealId") UUID appealId);

    // ================= 用户限制 =================

    /** 阶段 1：历史上的 BOOKING（限制预约新订单）限制在到期前同样拦截「申请联系方式」（CONTACT）。 */
    @Select("""
            SELECT id, scope, ends_at FROM user_restrictions
            WHERE user_id = #{userId} AND revoked_at IS NULL
              AND (scope = #{scope} OR (#{scope} = 'CONTACT' AND scope = 'BOOKING'))
              AND starts_at <= clock_timestamp() AND ends_at > clock_timestamp()
            ORDER BY ends_at DESC LIMIT 1
            """)
    Map<String, Object> selectActiveRestriction(@Param("userId") UUID userId, @Param("scope") String scope);

    /** 开始、结束与决定时间都取同一个 clock_timestamp()。ruleVersion 只用于 SYSTEM_RULE 来源。 */
    @Insert("""
            WITH t AS (SELECT clock_timestamp() AS at)
            INSERT INTO user_restrictions(id, user_id, school_id, scope, source, case_id, no_show_report_id, created_by,
                                          reason_code, starts_at, ends_at, rule_version, decided_at)
            SELECT #{id}, #{userId}, #{schoolId}, #{scope}, #{source}, #{caseId}, #{noShowReportId}, #{createdBy},
                   #{reasonCode}, t.at, t.at + make_interval(hours => #{hours}), #{ruleVersion}, t.at FROM t
            """)
    int insertRestriction(@Param("id") UUID id, @Param("userId") UUID userId, @Param("schoolId") String schoolId,
                          @Param("scope") String scope, @Param("source") String source, @Param("caseId") UUID caseId,
                          @Param("noShowReportId") UUID noShowReportId, @Param("createdBy") UUID createdBy,
                          @Param("reasonCode") String reasonCode, @Param("hours") int hours, @Param("ruleVersion") String ruleVersion);

    // ================= 7.1B 历史自动限制的依据与纠正（只读，V16 起冻结） =================

    @Select("""
            SELECT b.no_show_report_id, b.confirmed_at, n.status FROM user_restriction_basis b
            JOIN order_no_show_reports n ON n.id = b.no_show_report_id
            WHERE b.restriction_id = #{restrictionId} ORDER BY b.confirmed_at, b.no_show_report_id
            """)
    List<Map<String, Object>> selectBasis(@Param("restrictionId") UUID restrictionId);

    @Select("""
            SELECT id, outcome, remaining_count, previous_ends_at, new_ends_at, rule_version, created_at
            FROM user_restriction_corrections WHERE restriction_id = #{restrictionId} ORDER BY created_at, id
            """)
    List<Map<String, Object>> selectCorrections(@Param("restrictionId") UUID restrictionId);

    @Select("SELECT * FROM user_restrictions WHERE id = #{id}")
    Map<String, Object> selectRestriction(@Param("id") UUID id);

    @Select("SELECT * FROM user_restrictions WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockRestriction(@Param("id") UUID id);

    @Update("""
            UPDATE user_restrictions SET revoked_at = clock_timestamp(), revoked_by = #{by}, revoke_reason = #{reason}
            WHERE id = #{id} AND revoked_at IS NULL AND ends_at > clock_timestamp()
            """)
    int revokeRestriction(@Param("id") UUID id, @Param("by") UUID by, @Param("reason") String reason);

    /** 本人的限制（含已结束的，最近 50 条）：只有范围、期限、来源类别与原因码，没有举报人或工作人员身份。 */
    @Select("""
            SELECT r.id, r.scope, r.source, r.reason_code, r.starts_at, r.ends_at, r.revoked_at, r.revoke_reason,
                   r.rule_version, r.decided_at, r.no_show_report_id,
                   (r.revoked_at IS NULL AND r.starts_at <= clock_timestamp() AND r.ends_at > clock_timestamp()) AS active,
                   a.id AS appeal_id, a.status AS appeal_status, a.created_at AS appeal_created_at, a.decided_at AS appeal_decided_at
            FROM user_restrictions r LEFT JOIN moderation_appeals a ON a.restriction_id = r.id
            WHERE r.user_id = #{userId}
            ORDER BY r.created_at DESC LIMIT 50
            """)
    List<Map<String, Object>> selectMyRestrictions(@Param("userId") UUID userId);

    // ================= 历史爽约报告（只读，V16 起冻结） =================

    @Select("SELECT * FROM order_no_show_reports WHERE id = #{id}")
    Map<String, Object> selectNoShow(@Param("id") UUID id);

    // ================= 举报与案件 =================

    @Select("""
            SELECT * FROM moderation_cases
            WHERE school_id = #{schoolId} AND target_type = #{targetType} AND target_id = #{targetId}
              AND status IN ('OPEN','UNDER_REVIEW','APPEALED')
            FOR UPDATE
            """)
    Map<String, Object> lockOpenCase(@Param("schoolId") String schoolId, @Param("targetType") String targetType,
                                     @Param("targetId") UUID targetId);

    @Insert("""
            INSERT INTO moderation_cases(id, school_id, target_type, target_id, no_show_report_id)
            VALUES (#{id}, #{schoolId}, #{targetType}, #{targetId}, #{noShowReportId})
            ON CONFLICT DO NOTHING
            """)
    int insertCase(@Param("id") UUID id, @Param("schoolId") String schoolId, @Param("targetType") String targetType,
                   @Param("targetId") UUID targetId, @Param("noShowReportId") UUID noShowReportId);

    @Update("UPDATE moderation_cases SET report_count = report_count + 1, updated_at = clock_timestamp() WHERE id = #{id}")
    int bumpCase(@Param("id") UUID id);

    @Select("SELECT * FROM moderation_cases WHERE id = #{id}")
    Map<String, Object> selectCase(@Param("id") UUID id);

    @Select("SELECT * FROM moderation_cases WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockCase(@Param("id") UUID id);

    @Update("""
            UPDATE moderation_cases SET status = 'UNDER_REVIEW', assigned_staff_id = #{staff}, updated_at = clock_timestamp()
            WHERE id = #{id} AND status = 'OPEN'
            """)
    int claimCase(@Param("id") UUID id, @Param("staff") UUID staff);

    @Update("""
            UPDATE moderation_cases SET status = #{status}, resolution_code = #{resolution}, resolved_at = clock_timestamp(),
                   assigned_staff_id = COALESCE(assigned_staff_id, #{staff}), updated_at = clock_timestamp()
            WHERE id = #{id} AND status IN ('OPEN','UNDER_REVIEW')
            """)
    int resolveCase(@Param("id") UUID id, @Param("status") String status, @Param("resolution") String resolution, @Param("staff") UUID staff);

    @Update("UPDATE moderation_cases SET status = #{status}, updated_at = clock_timestamp() WHERE id = #{id} AND status = #{from}")
    int moveCase(@Param("id") UUID id, @Param("from") String from, @Param("status") String status);

    /** 工作人员待处理列表：学校在索引前缀，按创建时间分页（可按状态 / 目标类型筛选）。 */
    @Select("""
            <script>
            SELECT * FROM moderation_cases WHERE school_id = #{schoolId}
            <if test="status != null">AND status = #{status}</if>
            <if test="targetType != null">AND target_type = #{targetType}</if>
            AND staff_case_conflict(id, #{staff}) IS NULL
            ORDER BY created_at, id LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<Map<String, Object>> selectCases(@Param("schoolId") String schoolId, @Param("status") String status,
                                          @Param("targetType") String targetType, @Param("staff") UUID staff,
                                          @Param("limit") int limit, @Param("offset") int offset);

    @Select("""
            <script>
            SELECT count(*) FROM moderation_cases WHERE school_id = #{schoolId}
            <if test="status != null">AND status = #{status}</if>
            <if test="targetType != null">AND target_type = #{targetType}</if>
            AND staff_case_conflict(id, #{staff}) IS NULL
            </script>
            """)
    long countCases(@Param("schoolId") String schoolId, @Param("status") String status, @Param("targetType") String targetType,
                    @Param("staff") UUID staff);

    @Select("SELECT * FROM moderation_cases WHERE school_id = #{schoolId} AND target_type = #{targetType} AND target_id = #{targetId} ORDER BY created_at DESC LIMIT 20")
    List<Map<String, Object>> selectCasesForTarget(@Param("schoolId") String schoolId, @Param("targetType") String targetType,
                                                   @Param("targetId") UUID targetId);

    @Insert("""
            INSERT INTO moderation_reports(id, school_id, case_id, reporter_user_id, target_type, target_id, reason_code, note, snapshot)
            VALUES (#{id}, #{schoolId}, #{caseId}, #{reporter}, #{targetType}, #{targetId}, #{reasonCode}, #{note}, #{snapshot})
            ON CONFLICT (reporter_user_id, target_type, target_id) DO NOTHING
            """)
    int insertReport(@Param("id") UUID id, @Param("schoolId") String schoolId, @Param("caseId") UUID caseId,
                     @Param("reporter") UUID reporter, @Param("targetType") String targetType, @Param("targetId") UUID targetId,
                     @Param("reasonCode") String reasonCode, @Param("note") String note, @Param("snapshot") String snapshot);

    @Select("SELECT * FROM moderation_reports WHERE reporter_user_id = #{reporter} AND target_type = #{targetType} AND target_id = #{targetId}")
    Map<String, Object> selectReport(@Param("reporter") UUID reporter, @Param("targetType") String targetType, @Param("targetId") UUID targetId);

    /**
     * 举报人自己的举报：只有状态摘要。案件已结时只说明「已处理」或「未采取措施」，
     * 不给出具体动作、期限、工作人员或被举报人的任何处罚信息。
     */
    @Select("""
            SELECT r.id, r.target_type, r.target_id, r.reason_code, r.created_at, c.id AS case_id, c.status AS case_status, c.resolution_code
            FROM moderation_reports r JOIN moderation_cases c ON c.id = r.case_id
            WHERE r.reporter_user_id = #{reporter}
            ORDER BY r.created_at DESC LIMIT 100
            """)
    List<Map<String, Object>> selectMyReports(@Param("reporter") UUID reporter);

    /** 案件里的举报：原因、说明与必要快照；不带举报人身份。 */
    @Select("SELECT id, reason_code, note, snapshot, created_at FROM moderation_reports WHERE case_id = #{caseId} ORDER BY created_at, id LIMIT 100")
    List<Map<String, Object>> selectCaseReports(@Param("caseId") UUID caseId);

    // ================= 治理动作（只增不改） =================

    @Insert("""
            INSERT INTO moderation_actions(id, school_id, case_id, appeal_id, staff_user_id, action_code, reason_code, note,
                                           target_type, target_id, restriction_id, expires_at, effective, subject_user_id)
            VALUES (#{id}, #{schoolId}, #{caseId}, #{appealId}, #{staff}, #{actionCode}, #{reasonCode}, #{note},
                    #{targetType}, #{targetId}, #{restrictionId}, #{expiresAt}, #{effective}, #{subject})
            """)
    int insertAction(@Param("id") UUID id, @Param("schoolId") String schoolId, @Param("caseId") UUID caseId,
                     @Param("appealId") UUID appealId, @Param("staff") UUID staff, @Param("actionCode") String actionCode,
                     @Param("reasonCode") String reasonCode, @Param("note") String note, @Param("targetType") String targetType,
                     @Param("targetId") UUID targetId, @Param("restrictionId") UUID restrictionId,
                     @Param("expiresAt") OffsetDateTime expiresAt, @Param("effective") boolean effective, @Param("subject") UUID subject);

    @Select("SELECT * FROM moderation_actions WHERE case_id = #{caseId} ORDER BY created_at, id")
    List<Map<String, Object>> selectCaseActions(@Param("caseId") UUID caseId);

    @Select("SELECT * FROM moderation_actions WHERE id = #{id}")
    Map<String, Object> selectAction(@Param("id") UUID id);

    // ================= 商品隐藏 =================

    @Update("""
            UPDATE products SET moderation_hidden_at = clock_timestamp(), moderation_hidden_action_id = #{actionId}
            WHERE id = #{productId} AND moderation_hidden_at IS NULL
            """)
    int hideProduct(@Param("productId") UUID productId, @Param("actionId") UUID actionId);

    @Update("""
            UPDATE products SET moderation_hidden_at = NULL, moderation_hidden_action_id = #{actionId}
            WHERE id = #{productId} AND moderation_hidden_at IS NOT NULL
            """)
    int restoreProduct(@Param("productId") UUID productId, @Param("actionId") UUID actionId);

    /**
     * 与本人有关、可以申诉的处理（7.1E 起含评论隐藏、单条私信隔离）。
     * active = 处理仍在生效（内容仍隐藏 / 隔离）。历史上的爽约确认只展示：爽约规则已停用（V16），不再生效、不能申诉。
     * 不含举报人或工作人员身份。
     */
    @Select("""
            SELECT a.id, a.action_code, a.target_id, a.reason_code, a.created_at,
                   CASE a.action_code WHEN 'HIDE_PRODUCT' THEN (SELECT p.title FROM products p WHERE p.id = a.target_id) END AS title,
                   CASE a.action_code
                       WHEN 'HIDE_PRODUCT' THEN (SELECT p.moderation_hidden_at IS NOT NULL AND p.moderation_hidden_action_id = a.id
                                                 FROM products p WHERE p.id = a.target_id)
                       WHEN 'HIDE_COMMENT' THEN (SELECT cm.moderation_hidden_at IS NOT NULL AND cm.moderation_hidden_action_id = a.id
                                                 FROM comments cm WHERE cm.id = a.target_id)
                       WHEN 'QUARANTINE_MESSAGE' THEN (SELECT m.moderation_quarantined_at IS NOT NULL AND m.moderation_quarantine_action_id = a.id
                                                       FROM messages m WHERE m.id = a.target_id)
                       WHEN 'CONFIRM_NO_SHOW' THEN false
                   END AS active,
                   ap.id AS appeal_id, ap.status AS appeal_status, ap.created_at AS appeal_created_at, ap.decided_at AS appeal_decided_at
            FROM moderation_actions a LEFT JOIN moderation_appeals ap ON ap.action_id = a.id
            WHERE a.subject_user_id = #{userId} AND a.effective
              AND a.action_code IN ('HIDE_PRODUCT','HIDE_COMMENT','QUARANTINE_MESSAGE','CONFIRM_NO_SHOW')
            ORDER BY a.created_at DESC LIMIT 50
            """)
    List<Map<String, Object>> selectMyActionNotices(@Param("userId") UUID userId);

    // ================= 7.1E 评论隐藏 / 单条私信隔离（原文保留） =================

    @Select("SELECT id, user_id, moderation_hidden_at, moderation_hidden_action_id FROM comments WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockComment(@Param("id") UUID id);

    @Update("""
            UPDATE comments SET moderation_hidden_at = clock_timestamp(), moderation_hidden_action_id = #{actionId}
            WHERE id = #{id} AND moderation_hidden_at IS NULL
            """)
    int hideComment(@Param("id") UUID id, @Param("actionId") UUID actionId);

    @Update("""
            UPDATE comments SET moderation_hidden_at = NULL, moderation_hidden_action_id = #{actionId}
            WHERE id = #{id} AND moderation_hidden_at IS NOT NULL
            """)
    int restoreComment(@Param("id") UUID id, @Param("actionId") UUID actionId);

    @Select("SELECT id, sender_id, moderation_quarantined_at, moderation_quarantine_action_id FROM messages WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockMessage(@Param("id") UUID id);

    @Update("""
            UPDATE messages SET moderation_quarantined_at = clock_timestamp(), moderation_quarantine_action_id = #{actionId}
            WHERE id = #{id} AND moderation_quarantined_at IS NULL
            """)
    int quarantineMessage(@Param("id") UUID id, @Param("actionId") UUID actionId);

    @Update("""
            UPDATE messages SET moderation_quarantined_at = NULL, moderation_quarantine_action_id = #{actionId}
            WHERE id = #{id} AND moderation_quarantined_at IS NOT NULL
            """)
    int releaseMessage(@Param("id") UUID id, @Param("actionId") UUID actionId);

    // ================= 申诉 =================

    @Insert("""
            INSERT INTO moderation_appeals(id, school_id, user_id, restriction_id, action_id, case_id, reason)
            VALUES (#{id}, #{schoolId}, #{userId}, #{restrictionId}, #{actionId}, #{caseId}, #{reason})
            ON CONFLICT DO NOTHING
            """)
    int insertAppeal(@Param("id") UUID id, @Param("schoolId") String schoolId, @Param("userId") UUID userId,
                     @Param("restrictionId") UUID restrictionId, @Param("actionId") UUID actionId,
                     @Param("caseId") UUID caseId, @Param("reason") String reason);

    @Select("SELECT * FROM moderation_appeals WHERE restriction_id = #{restrictionId}")
    Map<String, Object> selectAppealByRestriction(@Param("restrictionId") UUID restrictionId);

    @Select("SELECT * FROM moderation_appeals WHERE action_id = #{actionId}")
    Map<String, Object> selectAppealByAction(@Param("actionId") UUID actionId);

    @Select("SELECT * FROM moderation_appeals WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockAppeal(@Param("id") UUID id);

    @Select("SELECT * FROM moderation_appeals WHERE id = #{id}")
    Map<String, Object> selectAppeal(@Param("id") UUID id);

    @Update("""
            UPDATE moderation_appeals SET status = #{status}, decided_by = #{staff}, decided_at = clock_timestamp()
            WHERE id = #{id} AND status = 'PENDING'
            """)
    int decideAppeal(@Param("id") UUID id, @Param("status") String status, @Param("staff") UUID staff);

    @Select("""
            <script>
            SELECT * FROM moderation_appeals WHERE school_id = #{schoolId}
            <if test="status != null">AND status = #{status}</if>
            AND staff_appeal_conflict(id, #{staff}) IS NULL
            ORDER BY created_at, id LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<Map<String, Object>> selectAppeals(@Param("schoolId") String schoolId, @Param("status") String status,
                                            @Param("staff") UUID staff, @Param("limit") int limit, @Param("offset") int offset);

    @Select("""
            <script>
            SELECT count(*) FROM moderation_appeals WHERE school_id = #{schoolId}
            <if test="status != null">AND status = #{status}</if>
            AND staff_appeal_conflict(id, #{staff}) IS NULL
            </script>
            """)
    long countAppeals(@Param("schoolId") String schoolId, @Param("status") String status, @Param("staff") UUID staff);

    // ================= 目标摘要（工作人员视图：只有处理所需的最少字段） =================

    @Select("""
            SELECT p.id, p.title, p.description, p.price, p.status, p.visibility, p.campus, p.moderation_hidden_at, p.seller_id,
                   u.nickname AS seller_nickname, c.school_id
            FROM products p JOIN users u ON u.id = p.seller_id JOIN campuses c ON c.id = p.campus WHERE p.id = #{id}
            """)
    Map<String, Object> selectProductTarget(@Param("id") UUID id);

    @Select("SELECT u.id, u.nickname, u.campus, u.created_at, c.school_id FROM users u JOIN campuses c ON c.id = u.campus WHERE u.id = #{id}")
    Map<String, Object> selectUserTarget(@Param("id") UUID id);

    @Select("""
            SELECT ci.id, ci.name, ci.description, ci.type, ci.visibility, ci.status, ci.school_id, ci.owner_user_id,
                   (SELECT count(*) FROM circle_memberships m WHERE m.circle_id = ci.id AND m.status = 'ACTIVE') AS member_count
            FROM circles ci WHERE ci.id = #{id}
            """)
    Map<String, Object> selectCircleTarget(@Param("id") UUID id);

    @Select("""
            SELECT cm.id, cm.content, cm.product_id, cm.user_id, cm.created_at, cm.moderation_hidden_at, u.nickname AS author_nickname, c.school_id
            FROM comments cm JOIN users u ON u.id = cm.user_id JOIN products p ON p.id = cm.product_id
            JOIN campuses c ON c.id = p.campus WHERE cm.id = #{id}
            """)
    Map<String, Object> selectCommentTarget(@Param("id") UUID id);

    /** 只取这一条消息（举报快照用）；不读同一会话里的其他消息。 */
    @Select("""
            SELECT m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.moderation_quarantined_at, cv.buyer_id, cv.seller_id,
                   u.nickname AS sender_nickname, c.school_id
            FROM messages m JOIN conversations cv ON cv.id = m.conversation_id JOIN users u ON u.id = m.sender_id
            JOIN products p ON p.id = cv.product_id JOIN campuses c ON c.id = p.campus WHERE m.id = #{id}
            """)
    Map<String, Object> selectMessageTarget(@Param("id") UUID id);

    /** 订单摘要：没有联系方式、确认码或幂等键。 */
    @Select("""
            SELECT o.id, o.status, o.price, o.meeting_at, o.meeting_ends_at, o.meeting_revision, o.buyer_id, o.seller_id,
                   o.product_id, b.nickname AS buyer_nickname, s.nickname AS seller_nickname, c.school_id
            FROM orders o JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
            JOIN products p ON p.id = o.product_id JOIN campuses c ON c.id = p.campus WHERE o.id = #{id}
            """)
    Map<String, Object> selectOrderTarget(@Param("id") UUID id);

    @Select("SELECT id, status FROM circles WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockCircle(@Param("id") UUID id);
}
