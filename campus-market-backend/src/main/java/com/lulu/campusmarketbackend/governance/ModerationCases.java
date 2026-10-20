package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * 治理案件的归并：同一学校、同一目标同时只有一个未结案件（部分唯一索引），后续举报并入它。
 * 并发创建时 INSERT … ON CONFLICT DO NOTHING 之后重新加锁读取，保证所有人拿到的是同一个案件。
 */
@Component
public class ModerationCases {
    private final GovernanceMapper governance;

    public ModerationCases(GovernanceMapper governance) {
        this.governance = governance;
    }

    /** 取得（必要时新建）目标的未结案件，并对案件行加锁。 */
    public Map<String, Object> ensure(String schoolId, String targetType, UUID targetId) {
        Map<String, Object> open = governance.lockOpenCase(schoolId, targetType, targetId);
        if (open != null) return open;
        governance.insertCase(UUID.randomUUID(), schoolId, targetType, targetId, null);
        return governance.lockOpenCase(schoolId, targetType, targetId);
    }

    public Map<String, Object> lockOpenFor(String targetType, UUID targetId, String schoolId) {
        return governance.lockOpenCase(schoolId, targetType, targetId);
    }

    /** 不加锁的查询（只用于展示「能否再请求复核」）。 */
    public Map<String, Object> openFor(String schoolId, String targetType, UUID targetId) {
        for (Map<String, Object> c : governance.selectCasesForTarget(schoolId, targetType, targetId)) {
            String status = String.valueOf(c.get("status"));
            if (status.equals("OPEN") || status.equals("UNDER_REVIEW") || status.equals("APPEALED")) return c;
        }
        return null;
    }
}
