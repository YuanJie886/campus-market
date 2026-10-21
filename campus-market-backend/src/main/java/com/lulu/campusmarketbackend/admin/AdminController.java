package com.lulu.campusmarketbackend.admin;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.api.RequestIdFilter;
import com.lulu.campusmarketbackend.governance.StaffModerationService;
import com.lulu.campusmarketbackend.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/v1/admin")
public class AdminController {
    private final AuthService auth;
    private final AdminService admin;
    private final AdminPermissions access;
    private final StaffModerationService moderation;
    private final com.lulu.campusmarketbackend.security.AccountService accounts;
    private final RegistrationInviteAdminService invites;

    public AdminController(AuthService auth, AdminService admin, AdminPermissions access, StaffModerationService moderation,
                           com.lulu.campusmarketbackend.security.AccountService accounts, RegistrationInviteAdminService invites) {
        this.auth = auth; this.admin = admin; this.access = access; this.moderation = moderation; this.accounts = accounts;
        this.invites = invites;
    }
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) { return admin.me(auth.authenticate(request, false)); }

    @GetMapping("/{resource:users|products|orders|audit|roles|role-requests|read-audit}")
    public Map<String, Object> list(HttpServletRequest request, @PathVariable String resource, @RequestParam Map<String, String> query) {
        return admin.list(auth.authenticate(request, false), resource, query, RequestIdFilter.currentRequestId(request));
    }
    @GetMapping("/{resource:users|products|orders|audit|roles|role-requests|read-audit}/{id}")
    public Map<String, Object> one(HttpServletRequest request, @PathVariable String resource, @PathVariable String id) {
        return admin.one(auth.authenticate(request, false), resource, id, RequestIdFilter.currentRequestId(request));
    }
    /** 阶段 2：涉及学校管理员的变更由另一位学校管理员确认 / 驳回，发起人可以撤回。 */
    @PostMapping("/role-requests/{id}/{decision:approve|reject|cancel}")
    public Map<String, Object> decideRoleRequest(HttpServletRequest request, @PathVariable String id, @PathVariable String decision,
                                                 @RequestBody(required = false) Map<String, Object> body) {
        return admin.decideRoleRequest(auth.authenticate(request, false), id, decision, body, RequestIdFilter.currentRequestId(request));
    }
    @PatchMapping("/users/{id}/staff")
    public Map<String, Object> staff(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return admin.updateStaff(auth.authenticate(request, false), id, body, RequestIdFilter.currentRequestId(request));
    }
    /** 阶段 3：学校管理员线下核对身份后为本校用户签发一次性重置码（只显示一次）。 */
    @PostMapping("/users/{id}/password-reset")
    public Map<String, Object> passwordReset(HttpServletRequest request, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        return accounts.issueResetCode(auth.authenticate(request, false), id, body, RequestIdFilter.currentRequestId(request));
    }
    /** V23：注册邀请码。不走通用的 {resource} 列表（分页参数是 page / size，且有签发与撤销），路径与契约一致。 */
    @GetMapping("/registration-invites")
    public Map<String, Object> registrationInvites(HttpServletRequest request, @RequestParam Map<String, String> query) {
        return invites.list(auth.authenticate(request, false), query, RequestIdFilter.currentRequestId(request));
    }
    @GetMapping("/registration-invites/{id}")
    public Map<String, Object> registrationInvite(HttpServletRequest request, @PathVariable String id) {
        return invites.detail(auth.authenticate(request, false), id, RequestIdFilter.currentRequestId(request));
    }
    @PostMapping("/registration-invites")
    public Map<String, Object> createRegistrationInvite(HttpServletRequest request, @RequestBody(required = false) Map<String, Object> body) {
        return invites.create(auth.authenticate(request, false), body);
    }
    @PostMapping("/registration-invites/{id}/revoke")
    public Map<String, Object> revokeRegistrationInvite(HttpServletRequest request, @PathVariable String id,
                                                        @RequestBody(required = false) Map<String, Object> body) {
        return invites.revoke(auth.authenticate(request, false), id, body);
    }
    @PatchMapping("/products/{id}")
    public Map<String, Object> product(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return admin.updateProduct(auth.authenticate(request, false), id, body, RequestIdFilter.currentRequestId(request));
    }
    @PostMapping("/products/{id}/visibility")
    public Map<String, Object> visibility(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return admin.productVisibility(auth.authenticate(request, false), id, body);
    }
    @GetMapping("/{resource:cases|appeals}")
    public Map<String, Object> queue(HttpServletRequest request, @PathVariable String resource, @RequestParam Map<String, String> query) {
        String uid = auth.authenticate(request, false);
        access.require(uid, resource + ":read");
        // 使用已有队列与利益回避条件，不另写案件查询。
        if (!java.util.Set.of("page", "perPage", "status", "targetType").containsAll(query.keySet())) throw ApiException.badRequest("查询参数无效");
        Map<String, String> translated = new java.util.LinkedHashMap<>(query);
        translated.put("size", translated.getOrDefault("perPage", "25")); translated.remove("perPage");
        return "cases".equals(resource) ? moderation.list(uid, translated) : moderation.appeals(uid, translated);
    }
    @GetMapping("/cases/{id}")
    public Map<String, Object> caseDetail(HttpServletRequest request, @PathVariable String id) {
        String uid = auth.authenticate(request, false); access.require(uid, "cases:read");
        return moderation.detail(uid, id);
    }
    @PostMapping("/cases/{id}/decision")
    public Map<String, Object> decide(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        String uid = auth.authenticate(request, false); access.require(uid, "cases:write");
        return moderation.decide(uid, id, body);
    }
    @PostMapping("/appeals/{id}/decision")
    public Map<String, Object> decideAppeal(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        String uid = auth.authenticate(request, false); access.require(uid, "appeals:write");
        return moderation.decideAppeal(uid, id, body);
    }
}
