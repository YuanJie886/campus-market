package com.lulu.campusmarketbackend.registration;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.security.OneTimeCodes;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 注册邀请码（V23）。首批小范围试运行只允许持邀请码注册：{@code campus-market.registration.invite-required}
 * （环境变量 {@code REGISTRATION_INVITE_REQUIRED}，默认 false）为 true 时，注册必须带本校工作人员签发的邀请码。
 *
 * <ul>
 *   <li>邀请码与重置码同一套格式（{@link OneTimeCodes}）：12 位、显示为 XXXX-XXXX-XXXX；库里只存规范化之后的 SHA-256 与末 4 位提示；
 *       明文只在签发那一次返回（后台创建响应 / 命令行输出），从不写日志；</li>
 *   <li>使用在注册事务里原子完成：带条件的 UPDATE（未撤销、未过期、已用次数小于上限、学校与所选校区一致）+1，再记录使用；
 *       注册失败（例如账号已存在）整个事务回滚，不占用次数；</li>
 *   <li>不存在、已撤销、已过期、已用完、不是这所学校的邀请码一律同一句话，不透露是哪一种。</li>
 * </ul>
 */
@Service
public class RegistrationInvites {
    public static final String MISSING = "请输入邀请码";
    public static final String INVALID = "邀请码无效或已用完";
    public static final int MAX_USES = 500;
    public static final int MAX_DAYS = 90;
    public static final int MAX_NOTE = 100;

    /** 新签发的邀请码：明文只在这里出现一次。 */
    public record Issued(UUID id, String code, int maxUses, Instant expiresAt) {}

    private final JdbcTemplate jdbc;
    private final boolean required;
    private final SecureRandom random = new SecureRandom();

    public RegistrationInvites(JdbcTemplate jdbc, @Value("${campus-market.registration.invite-required:false}") boolean required) {
        this.jdbc = jdbc;
        this.required = required;
    }

    public boolean required() {
        return required;
    }

    /** GET /v1/config 的 registration 段。 */
    public Map<String, Object> publicConfig() {
        return Map.of("inviteRequired", required);
    }

    /**
     * 注册时的第一步（不访问数据库）：要求邀请码时，缺少或为空白 400「请输入邀请码」。
     * 不要求时返回 null——字段照常接受但完全忽略（不校验、不占用）。
     */
    public String requirePresent(Object raw) {
        if (!required) return null;
        if (raw == null || (raw instanceof String s && s.isBlank())) throw ApiException.badRequest(MISSING);
        if (!(raw instanceof String s)) throw ApiException.badRequest(INVALID);
        return s;
    }

    /**
     * 在注册事务里占用一次（调用方必须已经在事务中，并在插入用户之后调用 {@link #recordUse}）。
     * 并发时同一行由 UPDATE 加锁串行化：后到的事务在前一个提交后重新判断条件，用完即 0 行。
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID consume(String rawCode, String schoolId) {
        String normalized = OneTimeCodes.normalize(rawCode);
        if (!OneTimeCodes.isWellFormed(normalized)) throw ApiException.badRequest(INVALID);
        List<UUID> rows = jdbc.queryForList("""
                UPDATE registration_invites SET used_count = used_count + 1
                WHERE code_hash = ? AND school_id = ? AND revoked_at IS NULL
                  AND expires_at > clock_timestamp() AND used_count < max_uses
                RETURNING id
                """, UUID.class, OneTimeCodes.sha256(normalized), schoolId);
        if (rows.isEmpty()) throw ApiException.badRequest(INVALID);
        return rows.get(0);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordUse(UUID inviteId, UUID userId) {
        jdbc.update("INSERT INTO registration_invite_uses(invite_id, user_id) VALUES (?, ?)", inviteId, userId);
    }

    /**
     * 签发一张邀请码（后台与命令行共用）。参数由调用方校验；数据库约束兜底（1～500 次、1～90 天、备注 100 字以内）。
     * createdBy 为 null 表示命令行签发。
     */
    @Transactional
    public Issued issue(String schoolId, int maxUses, int days, String note, UUID createdBy) {
        for (int attempt = 0; attempt < 5; attempt++) {
            String code = OneTimeCodes.generate(random);
            String normalized = OneTimeCodes.normalize(code);
            UUID id = UUID.randomUUID();
            // created_at 与 expires_at 取同一个时刻；天数按 24 小时计（与「不超过 2160 小时」的约束同一口径，不受时区夏令时影响）
            List<Instant> expires = jdbc.query("""
                    WITH t AS (SELECT clock_timestamp() AS now)
                    INSERT INTO registration_invites(id, school_id, code_hash, code_hint, max_uses, expires_at, note, created_by, created_at)
                    SELECT ?, ?, ?, ?, ?, t.now + make_interval(hours => ?), ?, ?, t.now FROM t
                    ON CONFLICT (code_hash) DO NOTHING
                    RETURNING expires_at
                    """, (rs, n) -> rs.getTimestamp(1).toInstant(),
                    id, schoolId, OneTimeCodes.sha256(normalized), normalized.substring(8), maxUses, days * 24, note, createdBy);
            if (!expires.isEmpty()) return new Issued(id, code, maxUses, expires.get(0));
        }
        throw new IllegalStateException("could not generate a unique registration invite code");
    }

    /** 命令行与后台签发前的参数校验。 */
    public static void validate(int maxUses, int days, String note) {
        if (maxUses < 1 || maxUses > MAX_USES) throw ApiException.badRequest("可用次数需为 1～" + MAX_USES + " 的整数");
        if (days < 1 || days > MAX_DAYS) throw ApiException.badRequest("有效天数需为 1～" + MAX_DAYS + " 的整数");
        if (note != null && note.codePointCount(0, note.length()) > MAX_NOTE) throw ApiException.badRequest("备注最多 " + MAX_NOTE + " 个字");
    }
}
