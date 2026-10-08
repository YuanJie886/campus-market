package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 模块 7.1C：工作人员利益回避的唯一检查点。判断本身在数据库函数里（V11 staff_case_conflict / staff_appeal_conflict），
 * 这里只负责在每次查看详情、领取、结案、立案、决定申诉之前调用，并给出统一的 403。
 *
 * <p>冲突原因码：SELF_TARGET（以本人为目标 / 本人的申诉）、OWN_CONTENT（本人的商品、评论、消息、圈子）、
 * OWN_CONVERSATION（本人参与的私信会话）、OWN_ORDER（本人参与的订单 / 爽约）、OWN_REPORT（本人提交的举报）、
 * OWN_ACTION（本人做出的原处理）。前端只根据原因码展示，不自行判断。
 */
@Component
public class ConflictGuard {

    private final GovernanceMapper governance;

    public ConflictGuard(GovernanceMapper governance) {
        this.governance = governance;
    }

    public String caseConflict(UUID caseId, UUID staff) {
        return governance.selectCaseConflict(caseId, staff);
    }

    public String appealConflict(UUID appealId, UUID staff) {
        return governance.selectAppealConflict(appealId, staff);
    }

    public void requireNoCaseConflict(UUID caseId, UUID staff) {
        String reason = caseConflict(caseId, staff);
        if (reason != null) throw conflict(reason, "这个案件与你本人有关，需要由其他工作人员处理");
    }

    public void requireNoAppealConflict(UUID appealId, UUID staff) {
        String reason = appealConflict(appealId, staff);
        if (reason != null) throw conflict(reason, "这条申诉与你本人或你做出的处理有关，需要由其他工作人员决定");
    }

    private static ApiException conflict(String reason, String message) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("code", "CONFLICT_OF_INTEREST");
        details.put("reason", reason);
        return new ApiException(403, message, details);
    }
}
