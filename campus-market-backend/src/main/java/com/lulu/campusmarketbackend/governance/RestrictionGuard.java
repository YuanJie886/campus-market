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
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 模块 7.5：用户限制的唯一检查点。
 *
 * <ul>
 *   <li>CONTACT：禁止发起新的联系申请与撤回后的重新申请（ContactRequestService.create）；对已有的 PENDING / APPROVED
 *       申请重复提交仍幂等返回原申请（200，不计入限流）；已有申请的查看、撤回与私信不受影响。
 *       历史上的 BOOKING（限制预约新订单）在到期前按 CONTACT 处理，新的限制不能再用 BOOKING（V16 守卫）；</li>
 *   <li>PUBLISHING：禁止单件 / 打包 / 批量 / 草稿最终发布（都经过 MarketService.createProductAs 与批量发布入口）；
 *       保存草稿、下架已发布商品不受影响；</li>
 *   <li>CIRCLE_CREATION：只禁止新建圈子；已有圈子的管理与退出不受影响。</li>
 * </ul>
 *
 * <p>检查时对用户行取 FOR SHARE，新建限制时对同一行取 FOR NO KEY UPDATE：
 * 「工作人员施加限制」与「用户发起申请」在这把行锁上串行化，结果是确定的——要么申请先成立，要么被拒。
 * 限制不对其他用户公开。限制只来自工作人员在案件里的决定；爽约自动规则已随站内交易停用（V16 撤销了仍在生效的自动限制）。
 */
@Component
public class RestrictionGuard {

    public static final Set<String> SCOPES = Set.of("CONTACT", "PUBLISHING", "CIRCLE_CREATION");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("M 月 d 日 HH:mm").withZone(ZoneId.of("Asia/Shanghai"));

    private final GovernanceMapper governance;
    private final UserMapper users;

    public RestrictionGuard(GovernanceMapper governance, UserMapper users) {
        this.governance = governance;
        this.users = users;
    }

    public void require(UUID userId, String scope) {
        ApiException restricted = check(userId, scope);
        if (restricted != null) throw restricted;
    }

    /**
     * 与 {@link #require} 相同的加锁与判断，但把结果交给调用方决定何时抛出：
     * 联系申请需要先按原有锁顺序（用户行 → 商品行）取锁，再在确认「这不是一次幂等重放」之后才拒绝。
     *
     * @return 生效中的限制对应的 403；没有限制时返回 null
     */
    public ApiException check(UUID userId, String scope) {
        users.lockShare(userId);
        Map<String, Object> row = governance.selectActiveRestriction(userId, scope);
        if (row == null) return null;
        long endsAt = DomainMapper.epoch(row.get("ends_at"));
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("code", "RESTRICTED");
        details.put("scope", scope);
        details.put("endsAt", endsAt);
        String what = switch (scope) {
            case "CONTACT" -> "申请联系方式";
            case "PUBLISHING" -> "发布商品";
            default -> "创建圈子";
        };
        return new ApiException(403, "你的「" + what + "」功能暂时受限，至 " + TIME.format(Instant.ofEpochMilli(endsAt))
                + " 自动恢复。可以在「我的限制」里查看原因或提交申诉。", details);
    }

    /** 新建一条限制（1～720 小时）。先锁用户行，与 {@link #require} 串行化。 */
    public UUID create(UUID userId, String schoolId, String scope, UUID caseId, UUID createdBy, String reasonCode, int hours) {
        if (!SCOPES.contains(scope)) throw ApiException.badRequest("限制范围无效");
        if (hours < 1 || hours > 720) throw ApiException.badRequest("限制期限应为 1～720 小时（最长 30 天）");
        users.lockById(userId);
        UUID id = UUID.randomUUID();
        governance.insertRestriction(id, userId, schoolId, scope, "CASE", caseId, null, createdBy, reasonCode, hours, null);
        return id;
    }
}
