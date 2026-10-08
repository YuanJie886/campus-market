package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.GovernanceMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 模块 7.3：平台工作人员鉴权。
 *
 * <p>工作人员身份<b>每次请求都从数据库读取</b>（staff_members.active 且学校与本人所在学校一致），
 * 不写进 JWT，也不信任任何客户端提交的角色字段；停用或调离学校立即生效。
 * 表默认为空，没有任何默认账号；首个工作人员按运维手册用受控 SQL 配置。
 */
@Component
public class StaffGuard {

    public record Staff(UUID userId, String schoolId, String role) {
        public boolean senior() { return "SENIOR_MODERATOR".equals(role); }
    }

    private final GovernanceMapper governance;

    public StaffGuard(GovernanceMapper governance) {
        this.governance = governance;
    }

    /** 非工作人员一律 403：页面入口隐藏只是体验，权限以这里为准。 */
    public Staff require(String uid) {
        Staff staff = find(uid);
        if (staff == null) throw ApiException.forbidden("需要平台工作人员权限");
        return staff;
    }

    public Staff find(String uid) {
        UUID id;
        try {
            id = UUID.fromString(uid);
        } catch (IllegalArgumentException | NullPointerException e) {
            return null;
        }
        Map<String, Object> row = governance.selectActiveStaff(id);
        if (row == null) return null;
        return new Staff(id, DomainMapper.text(row.get("school_id")), DomainMapper.text(row.get("role")));
    }

    /** 给前端决定是否显示工作台入口；不返回任何其他工作人员信息。 */
    public Map<String, Object> status(String uid) {
        Staff staff = find(uid);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("staff", staff != null);
        result.put("role", staff == null ? null : staff.role());
        return result;
    }
}
