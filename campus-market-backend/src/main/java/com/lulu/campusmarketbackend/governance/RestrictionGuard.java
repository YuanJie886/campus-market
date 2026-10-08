package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import com.lulu.campusmarketbackend.mapper.UserMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 7.5：用户限制的唯一检查点。
 *
 * <ul>
 *   <li>BOOKING：只禁止创建新订单（OrderService.create）；已有订单的验货、确认、取消、消息不受影响；</li>
 *   <li>PUBLISHING：禁止单件 / 打包 / 批量 / 草稿最终发布（都经过 MarketService.createProductAs 与批量发布入口）；
 *       保存草稿、下架已发布商品不受影响；</li>
 *   <li>CIRCLE_CREATION：只禁止新建圈子；已有圈子的管理与退出不受影响。</li>
 * </ul>
 *
 * <p>检查时对用户行取 FOR SHARE，新建限制时对同一行取 FOR NO KEY UPDATE：
 * 「工作人员施加限制」与「用户下单」在这把行锁上串行化，结果是确定的——要么订单先成立，要么下单被拒。
 * 限制不对其他用户公开。
 */
@Component
public class RestrictionGuard {

    public static final Set<String> SCOPES = Set.of("BOOKING", "PUBLISHING", "CIRCLE_CREATION");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("M 月 d 日 HH:mm").withZone(ZoneId.of("Asia/Shanghai"));

    private final GovernanceMapper governance;
    private final UserMapper users;

    public RestrictionGuard(GovernanceMapper governance, UserMapper users) {
        this.governance = governance;
        this.users = users;
    }

    public void require(UUID userId, String scope) {
        users.lockShare(userId);
        Map<String, Object> row = governance.selectActiveRestriction(userId, scope);
        if (row == null) return;
        long endsAt = DomainMapper.epoch(row.get("ends_at"));
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("code", "RESTRICTED");
        details.put("scope", scope);
        details.put("endsAt", endsAt);
        String what = switch (scope) {
            case "BOOKING" -> "预约新订单";
            case "PUBLISHING" -> "发布商品";
            default -> "创建圈子";
        };
        throw new ApiException(403, "你的「" + what + "」功能暂时受限，至 " + TIME.format(Instant.ofEpochMilli(endsAt))
                + " 自动恢复。可以在「我的限制」里查看原因或提交申诉。", details);
    }

    /** 新建一条限制（1～720 小时）。先锁用户行，与 {@link #require} 串行化。 */
    public UUID create(UUID userId, String schoolId, String scope, String source, UUID caseId, UUID noShowReportId,
                       UUID createdBy, String reasonCode, int hours) {
        if (!SCOPES.contains(scope)) throw ApiException.badRequest("限制范围无效");
        if (hours < 1 || hours > 720) throw ApiException.badRequest("限制期限应为 1～720 小时（最长 30 天）");
        users.lockById(userId);
        UUID id = UUID.randomUUID();
        governance.insertRestriction(id, userId, schoolId, scope, source, caseId, noShowReportId, createdBy, reasonCode, hours, null);
        return id;
    }

    /** 公开规则的版本号，写入每条自动限制与纠正记录。规则变化时换新版本号，旧限制保留旧版本号。 */
    public static final String RULE_VERSION = "NO_SHOW_V1";

    /** 规则本身：30 天内已确认爽约次数 → 预约限制小时数（0 = 只提醒）。 */
    public static int ruleHours(int confirmed) {
        return confirmed >= 3 ? 72 : confirmed == 2 ? 24 : 0;
    }

    /**
     * 确认爽约后的公开规则（保守且透明）：30 天内第 1 次只提醒；第 2 次限制预约 24 小时；第 3 次及以上 72 小时。
     * <ul>
     *   <li>计数口径：<b>确认时间</b>（对方承认或工作人员确认的时刻）落在决定时刻之前 30 天内；沿用 V10 语义；</li>
     *   <li>只计有明确档期快照的确认（7.1A）；单方 PENDING、DISPUTED、REJECTED、EXPIRED 都不计数；</li>
     *   <li>自动限制来源为 SYSTEM_RULE，保存来源报告、规则版本、决定时间与所依据的确认记录（user_restriction_basis）；</li>
     *   <li>同一份报告至多触发一次（唯一索引兜底）。</li>
     * </ul>
     *
     * @param staff 工作人员确认时为该工作人员；对方自行承认时为 null
     * @return 新建的限制；只是提醒时返回 null
     */
    public UUID applyNoShowRule(UUID reportedUser, String schoolId, UUID reportId, UUID caseId, UUID staff) {
        users.lockById(reportedUser);
        List<Map<String, Object>> basis = governance.selectConfirmedNoShowsInWindow(reportedUser);
        int hours = ruleHours(basis.size());
        if (hours == 0) return null;
        UUID id = UUID.randomUUID();
        governance.insertRestriction(id, reportedUser, schoolId, "BOOKING", "SYSTEM_RULE", caseId, reportId, staff,
                "CONFIRMED_NO_SHOW", hours, RULE_VERSION);
        for (Map<String, Object> b : basis) governance.insertBasis(id, (UUID) b.get("id"), b.get("confirmed_at"));
        return id;
    }

    /**
     * 7.1B：一次已确认的爽约被申诉推翻后，重算以它为依据、尚未撤销的自动限制。
     * <ul>
     *   <li>已自然到期的限制不改动，只保留原有审计；</li>
     *   <li>来源报告本身被推翻 → 撤销；否则按依据中仍处于已确认状态的次数重新套用<b>决定时的规则版本</b>；</li>
     *   <li>只减轻或撤销：新的结束时间 = 开始时间 + 新时长，且不晚于原结束时间；已经不足以覆盖到现在的直接撤销；</li>
     *   <li>每次变化追加一条纠正记录（user_restriction_corrections），历史动作不删除；人工（CASE）限制不受影响。</li>
     * </ul>
     * 调用方必须已经锁住用户行（与新建限制、下单检查串行化）。
     *
     * @return 每条被纠正限制的结果（restrictionId → SHORTENED / REVOKED）
     */
    public Map<UUID, String> recomputeAfterOverturn(UUID causeReportId, UUID appealId, UUID decidedBy) {
        Map<UUID, String> outcomes = new LinkedHashMap<>();
        Instant now = governance.selectNow().toInstant();
        for (Map<String, Object> r : governance.lockRestrictionsBasedOn(causeReportId)) {
            UUID id = (UUID) r.get("id");
            Instant starts = Instant.ofEpochMilli(DomainMapper.epoch(r.get("starts_at")));
            Instant ends = Instant.ofEpochMilli(DomainMapper.epoch(r.get("ends_at")));
            if (!ends.isAfter(now)) continue;                       // 已到期：只保留审计
            int remaining = 0;
            for (Map<String, Object> b : governance.selectBasis(id)) {
                if (Set.of("ACKNOWLEDGED", "CONFIRMED").contains(DomainMapper.text(b.get("status")))) remaining++;
            }
            boolean sourceOverturned = causeReportId.equals(r.get("no_show_report_id"));
            int hours = sourceOverturned ? 0 : ruleHours(remaining);
            // 自动限制的时长都是整小时（开始时间 + N 小时）；按小时数比较，避免毫秒截断带来的误判
            long currentHours = Math.round(java.time.Duration.between(starts, ends).toMinutes() / 60.0);
            if (hours > 0 && hours >= currentHours) continue;       // 重算不会更重：保持原样
            Instant newEnds = starts.plus(java.time.Duration.ofHours(hours));
            String outcome = hours == 0 || !newEnds.isAfter(now) ? "REVOKED" : "SHORTENED";
            UUID correction = UUID.randomUUID();
            if (governance.insertCorrection(correction, id, causeReportId, appealId, decidedBy, outcome, remaining, hours) == 0) continue;
            int changed = "REVOKED".equals(outcome) ? governance.revokeRecomputed(id, decidedBy, correction)
                    : governance.shortenRestriction(correction);
            if (changed != 1) throw new IllegalStateException("restriction correction lost its row");
            outcomes.put(id, outcome);
        }
        return outcomes;
    }
}
