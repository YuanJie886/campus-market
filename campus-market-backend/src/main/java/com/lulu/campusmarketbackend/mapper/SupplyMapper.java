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
 * 毕业季通用供给引擎（模块 5）的数据访问：草稿、批次、幂等记录、协助邀请、价格参考。
 *
 * <p>每个读方法都带所有者或协助人条件；没有「按商品列出协助人」「按学校列出成交价」一类的公开读路径。
 */
@Mapper
public interface SupplyMapper {

    // ================= 草稿 =================

    String DRAFT_COLUMNS = "d.id, d.owner_user_id, d.editor_user_id, d.draft_type, d.payload::text AS payload, d.version, "
            + "d.status, d.expires_at, d.published_product_id, d.created_at, d.updated_at, "
            + "(SELECT bi.batch_id FROM listing_batch_items bi WHERE bi.draft_id = d.id AND bi.active) AS batch_id";

    @Insert("INSERT INTO listing_drafts(id, owner_user_id, editor_user_id, draft_type, payload, expires_at) "
            + "VALUES (#{id}, #{owner}, #{owner}, #{type}, #{payload}::jsonb, #{expiresAt})")
    int insertDraft(@Param("id") UUID id, @Param("owner") UUID owner, @Param("type") String type,
                    @Param("payload") String payload, @Param("expiresAt") OffsetDateTime expiresAt);

    @Select("SELECT " + DRAFT_COLUMNS + " FROM listing_drafts d WHERE d.id = #{id}")
    Map<String, Object> selectDraft(@Param("id") UUID id);

    @Select("SELECT " + DRAFT_COLUMNS + " FROM listing_drafts d WHERE d.owner_user_id = #{owner} "
            + "ORDER BY d.updated_at DESC, d.id LIMIT #{limit}")
    List<Map<String, Object>> selectDraftsByOwner(@Param("owner") UUID owner, @Param("limit") int limit);

    /** 协助人可编辑的草稿：生效中、未过期的邀请所覆盖的草稿（单个草稿，或批次里仍在批次中的草稿）。 */
    @Select("SELECT DISTINCT ON (d.id) " + DRAFT_COLUMNS + " FROM listing_assist_invites i "
            + "JOIN listing_drafts d ON d.id = i.draft_id "
            + "OR d.id IN (SELECT bi.draft_id FROM listing_batch_items bi WHERE bi.batch_id = i.batch_id AND bi.active) "
            + "WHERE i.assistant_user_id = #{assistant} AND i.status = 'ACTIVE' AND i.expires_at > now() ORDER BY d.id")
    List<Map<String, Object>> selectDraftsForAssistant(@Param("assistant") UUID assistant);

    /** 某人是否（通过生效中的邀请）有权编辑这个草稿。 */
    @Select("""
            SELECT count(*) FROM listing_assist_invites i
            WHERE i.assistant_user_id = #{assistant} AND i.status = 'ACTIVE' AND i.expires_at > now()
              AND (i.draft_id = #{draftId}
                   OR i.batch_id IN (SELECT bi.batch_id FROM listing_batch_items bi WHERE bi.draft_id = #{draftId} AND bi.active))
            """)
    long countAssistantAccess(@Param("draftId") UUID draftId, @Param("assistant") UUID assistant);

    @Select("""
            SELECT i.id FROM listing_assist_invites i
            WHERE i.assistant_user_id = #{assistant} AND i.status = 'ACTIVE' AND i.expires_at > now()
              AND (i.draft_id = #{draftId}
                   OR i.batch_id IN (SELECT bi.batch_id FROM listing_batch_items bi WHERE bi.draft_id = #{draftId} AND bi.active))
            ORDER BY i.created_at DESC LIMIT 1
            """)
    UUID selectAssistInviteFor(@Param("draftId") UUID draftId, @Param("assistant") UUID assistant);

    /** 乐观锁写入：只有版本号仍等于客户端读到的版本时才更新。返回 0 表示冲突或状态已不可写。 */
    @Update("""
            UPDATE listing_drafts SET payload = #{payload}::jsonb, status = #{status}, editor_user_id = #{editor},
                   version = version + 1, updated_at = now(), expires_at = #{expiresAt}
            WHERE id = #{id} AND version = #{expectedVersion} AND status IN ('DRAFT', 'READY') AND expires_at > now()
            """)
    int updateDraft(@Param("id") UUID id, @Param("expectedVersion") int expectedVersion, @Param("editor") UUID editor,
                    @Param("payload") String payload, @Param("status") String status,
                    @Param("expiresAt") OffsetDateTime expiresAt);

    /** 读取时发现已过期：显式落为 EXPIRED（不删除任何用户数据）。 */
    @Update("UPDATE listing_drafts SET status = 'EXPIRED', updated_at = now() "
            + "WHERE id = #{id} AND status IN ('DRAFT', 'READY') AND expires_at <= now()")
    int markExpired(@Param("id") UUID id);

    @Update("UPDATE listing_drafts SET status = 'EXPIRED', updated_at = now() "
            + "WHERE owner_user_id = #{owner} AND status IN ('DRAFT', 'READY') AND expires_at <= now()")
    int markOwnerExpired(@Param("owner") UUID owner);

    @Update("UPDATE listing_drafts SET status = 'DISCARDED', version = version + 1, updated_at = now() "
            + "WHERE id = #{id} AND owner_user_id = #{owner} AND status IN ('DRAFT', 'READY')")
    int discardDraft(@Param("id") UUID id, @Param("owner") UUID owner);

    @Update("UPDATE listing_drafts SET status = 'PUBLISHED', published_product_id = #{productId}, "
            + "version = version + 1, updated_at = now() WHERE id = #{id} AND status IN ('DRAFT', 'READY')")
    int markDraftPublished(@Param("id") UUID id, @Param("productId") UUID productId);

    // ================= 批次 =================

    @Insert("INSERT INTO listing_batches(id, owner_user_id) VALUES (#{id}, #{owner})")
    int insertBatch(@Param("id") UUID id, @Param("owner") UUID owner);

    @Insert("""
            <script>
            INSERT INTO listing_batch_items(batch_id, draft_id, owner_user_id, position) VALUES
            <foreach collection="draftIds" item="d" index="i" separator=",">
              (#{batchId}, #{d}, #{owner}, #{i} + 1)
            </foreach>
            </script>
            """)
    int insertBatchItems(@Param("batchId") UUID batchId, @Param("owner") UUID owner, @Param("draftIds") List<UUID> draftIds);

    @Update("DELETE FROM listing_batch_items WHERE batch_id = #{batchId}")
    int deleteBatchItems(@Param("batchId") UUID batchId);

    @Select("SELECT id, owner_user_id, status, version, published_at, created_at, updated_at FROM listing_batches WHERE id = #{id}")
    Map<String, Object> selectBatch(@Param("id") UUID id);

    @Select("SELECT id, owner_user_id, status, version, published_at, created_at, updated_at FROM listing_batches "
            + "WHERE id = #{id} FOR UPDATE")
    Map<String, Object> lockBatch(@Param("id") UUID id);

    @Select("SELECT b.id, b.status, b.version, b.published_at, b.created_at, b.updated_at, "
            + "(SELECT count(*) FROM listing_batch_items bi WHERE bi.batch_id = b.id) AS item_count "
            + "FROM listing_batches b WHERE b.owner_user_id = #{owner} ORDER BY b.created_at DESC, b.id LIMIT 50")
    List<Map<String, Object>> selectBatchesByOwner(@Param("owner") UUID owner);

    /** 批次条目与草稿一次取回（一条 SQL，与条目数无关）。 */
    @Select("SELECT bi.position, bi.product_id AS item_product_id, bi.active AS item_active, " + DRAFT_COLUMNS
            + " FROM listing_batch_items bi JOIN listing_drafts d ON d.id = bi.draft_id "
            + "WHERE bi.batch_id = #{batchId} ORDER BY bi.position")
    List<Map<String, Object>> selectBatchItems(@Param("batchId") UUID batchId);

    @Select("""
            <script>
            SELECT id FROM listing_drafts WHERE id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY id FOR UPDATE
            </script>
            """)
    List<UUID> lockDrafts(@Param("ids") List<UUID> ids);

    @Update("UPDATE listing_batches SET version = version + 1, updated_at = now() WHERE id = #{id} AND version = #{expectedVersion} AND status = 'OPEN'")
    int bumpBatch(@Param("id") UUID id, @Param("expectedVersion") int expectedVersion);

    @Update("UPDATE listing_batches SET status = 'PUBLISHED', published_at = now(), version = version + 1, updated_at = now() "
            + "WHERE id = #{id} AND status = 'OPEN'")
    int markBatchPublished(@Param("id") UUID id);

    @Update("UPDATE listing_batches SET status = 'DISCARDED', version = version + 1, updated_at = now() "
            + "WHERE id = #{id} AND owner_user_id = #{owner} AND status = 'OPEN'")
    int discardBatch(@Param("id") UUID id, @Param("owner") UUID owner);

    @Update("UPDATE listing_batch_items SET active = false WHERE batch_id = #{batchId}")
    int deactivateBatchItems(@Param("batchId") UUID batchId);

    @Update("UPDATE listing_batch_items SET product_id = #{productId} WHERE batch_id = #{batchId} AND draft_id = #{draftId}")
    int setBatchItemProduct(@Param("batchId") UUID batchId, @Param("draftId") UUID draftId, @Param("productId") UUID productId);

    // ================= 幂等 =================

    @Select("SELECT request_hash, batch_id, product_ids::text[] AS product_ids FROM listing_publish_requests "
            + "WHERE owner_user_id = #{owner} AND idempotency_key = #{key}")
    Map<String, Object> selectPublishRequest(@Param("owner") UUID owner, @Param("key") String key);

    @Insert("INSERT INTO listing_publish_requests(owner_user_id, idempotency_key, request_hash, batch_id, product_ids) "
            + "VALUES (#{owner}, #{key}, #{hash}, #{batchId}, #{productIds,typeHandler=org.apache.ibatis.type.ArrayTypeHandler}::uuid[])")
    int insertPublishRequest(@Param("owner") UUID owner, @Param("key") String key, @Param("hash") String hash,
                             @Param("batchId") UUID batchId, @Param("productIds") String[] productIds);

    // ================= 协助邀请 =================

    /** 到期时间与 created_at 用同一个数据库 now() 计算：应用与数据库的时钟偏差不会让 7 天上限的 CHECK 误判。 */
    @Insert("INSERT INTO listing_assist_invites(id, owner_user_id, draft_id, batch_id, token_hash, expires_at) "
            + "VALUES (#{id}, #{owner}, #{draftId}, #{batchId}, #{tokenHash}, now() + make_interval(hours => #{hours}))")
    int insertInvite(@Param("id") UUID id, @Param("owner") UUID owner, @Param("draftId") UUID draftId,
                     @Param("batchId") UUID batchId, @Param("tokenHash") String tokenHash,
                     @Param("hours") int hours);

    @Select("SELECT * FROM listing_assist_invites WHERE token_hash = #{tokenHash} FOR UPDATE")
    Map<String, Object> lockInviteByHash(@Param("tokenHash") String tokenHash);

    @Update("UPDATE listing_assist_invites SET status = 'ACTIVE', assistant_user_id = #{assistant}, redeemed_at = now() "
            + "WHERE id = #{id} AND status = 'PENDING' AND expires_at > now()")
    int activateInvite(@Param("id") UUID id, @Param("assistant") UUID assistant);

    @Update("UPDATE listing_assist_invites SET status = 'REVOKED', revoked_at = now() "
            + "WHERE id = #{id} AND owner_user_id = #{owner} AND status <> 'REVOKED'")
    int revokeInvite(@Param("id") UUID id, @Param("owner") UUID owner);

    @Select("SELECT i.id, i.draft_id, i.batch_id, i.status, i.expires_at, i.created_at, i.redeemed_at, i.revoked_at, "
            + "u.nickname AS assistant_nickname FROM listing_assist_invites i "
            + "LEFT JOIN users u ON u.id = i.assistant_user_id WHERE i.owner_user_id = #{owner} "
            + "ORDER BY i.created_at DESC, i.id LIMIT 100")
    List<Map<String, Object>> selectInvitesByOwner(@Param("owner") UUID owner);

    @Select("SELECT * FROM listing_assist_invites WHERE id = #{id} AND owner_user_id = #{owner}")
    Map<String, Object> selectOwnInvite(@Param("id") UUID id, @Param("owner") UUID owner);

    @Insert("INSERT INTO listing_assist_events(invite_id, actor_user_id, event_code, draft_id) "
            + "VALUES (#{inviteId}, #{actor}, #{code}, #{draftId})")
    int insertAssistEvent(@Param("inviteId") UUID inviteId, @Param("actor") UUID actor, @Param("code") String code,
                          @Param("draftId") UUID draftId);

    @Select("SELECT event_code, draft_id, created_at, (actor_user_id = #{owner}) AS by_owner FROM listing_assist_events "
            + "WHERE invite_id = #{inviteId} ORDER BY seq")
    List<Map<String, Object>> selectAssistEvents(@Param("inviteId") UUID inviteId, @Param("owner") UUID owner);

    /** 每个草稿最后一次协助编辑的人与对应邀请（一条 SQL，与草稿数无关）。 */
    @Select("""
            <script>
            SELECT DISTINCT ON (e.draft_id) e.draft_id, e.actor_user_id, e.invite_id
            FROM listing_assist_events e
            WHERE e.event_code = 'ASSIST_DRAFT_EDITED' AND e.draft_id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
            ORDER BY e.draft_id, e.seq DESC
            </script>
            """)
    List<Map<String, Object>> selectLastAssistEditors(@Param("ids") List<UUID> ids);

    // ================= 价格参考 =================

    /**
     * 校内历史成交价的聚合（只返回聚合值，没有任何单笔记录）。
     * 口径（V8 起只读订单上的不可变快照）：同一学校、已完成、单件（排除整套打包）、有成交价与统计维度快照。
     * 不连接商品或校区：商品成交后改分类、成色、校区或教材版本，都不会让历史样本移动。
     */
    @Select("""
            <script>
            SELECT count(*) AS sample_count,
                   percentile_cont(0.5)  WITHIN GROUP (ORDER BY o.price_snapshot) AS median,
                   percentile_cont(0.25) WITHIN GROUP (ORDER BY o.price_snapshot) AS lower_quartile,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY o.price_snapshot) AS upper_quartile,
                   to_char(date_trunc('month', min(o.updated_at)), 'YYYY-MM') AS period_start,
                   to_char(date_trunc('month', max(o.updated_at)), 'YYYY-MM') AS period_end
            FROM orders o
            WHERE o.status = 'COMPLETED'
              AND o.price_snapshot IS NOT NULL
              AND o.listing_kind_snapshot = 'SINGLE'
              AND o.visibility_snapshot IS DISTINCT FROM 'CIRCLE_ONLY'
              AND o.school_id_snapshot = #{schoolId}
              AND o.category_snapshot = #{category}
              <if test="condition != null">AND o.condition_snapshot = #{condition}</if>
              <if test="textbookEditionId != null">AND o.textbook_edition_id_snapshot = #{textbookEditionId}</if>
            </script>
            """)
    Map<String, Object> selectPriceGuidance(@Param("schoolId") String schoolId, @Param("category") String category,
                                            @Param("condition") String condition,
                                            @Param("textbookEditionId") String textbookEditionId);

    @Select("SELECT id, school_id FROM campuses")
    List<Map<String, Object>> selectCampusSchools();
}
