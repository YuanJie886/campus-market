package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 权限每次由数据库中的在岗角色确定；JWT 和请求体都不是角色真值。
 *
 * <p>阶段 2：高级审核员（SENIOR_MODERATOR）是后台接入之前就存在的角色，接入后台不得自动扩大它的权限
 * （README「接入代码不会为现有账号自动增加权限」）。因此它与审核员一样只有治理与商品只读；
 * 更长的限制、强制归档圈子等「高级」差别仍在治理服务里判断。用户、历史订单与审计的只读、商品编辑与展示管理
 * 只属于学校管理员与只读审计员（审计员只读）。
 */
@Component
public class AdminPermissions {
    public static final Map<String, String> ROLES = Map.of(
            "SCHOOL_ADMIN", "学校管理员", "SENIOR_MODERATOR", "高级审核员",
            "MODERATOR", "审核员", "AUDITOR", "只读审计员");
    private static final Set<String> READ_ONLY = Set.of("users:read", "products:read", "orders:read", "audit:read", "roles:read",
            "role-requests:read", "read-audit:read", "registration-invites:read");
    private static final Set<String> MODERATION = Set.of("products:read", "cases:read", "cases:write", "appeals:read", "appeals:write");
    private final StaffGuard staff;

    public AdminPermissions(StaffGuard staff) { this.staff = staff; }

    public static List<String> permissions(String role) {
        Set<String> result = new java.util.TreeSet<>();
        if ("AUDITOR".equals(role)) result.addAll(READ_ONLY);
        if (Set.of("MODERATOR", "SENIOR_MODERATOR", "SCHOOL_ADMIN").contains(role)) result.addAll(MODERATION);
        if ("SCHOOL_ADMIN".equals(role)) {
            result.addAll(READ_ONLY);
            result.add("products:write");
            result.add("users:write");
            // V23：签发 / 撤销本校注册邀请码
            result.add("registration-invites:write");
        }
        return List.copyOf(result);
    }

    public StaffGuard.Staff identity(String uid) {
        StaffGuard.Staff member = staff.find(uid);
        if (member == null || !ROLES.containsKey(member.role())) throw ApiException.forbidden("此账号没有管理后台访问权限");
        return member;
    }

    public StaffGuard.Staff require(String uid, String permission) {
        StaffGuard.Staff member = identity(uid);
        if (!permissions(member.role()).contains(permission)) throw ApiException.forbidden("没有执行此操作的权限");
        return member;
    }
}
