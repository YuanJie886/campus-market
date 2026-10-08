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

    public AdminController(AuthService auth, AdminService admin, AdminPermissions access, StaffModerationService moderation) {
        this.auth = auth; this.admin = admin; this.access = access; this.moderation = moderation;
    }
    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) { return admin.me(auth.authenticate(request, false)); }

    @GetMapping("/{resource:users|products|orders|audit|roles}")
    public Map<String, Object> list(HttpServletRequest request, @PathVariable String resource, @RequestParam Map<String, String> query) {
        return admin.list(auth.authenticate(request, false), resource, query);
    }
    @GetMapping("/{resource:users|products|orders|audit|roles}/{id}")
    public Map<String, Object> one(HttpServletRequest request, @PathVariable String resource, @PathVariable String id) {
        return admin.one(auth.authenticate(request, false), resource, id);
    }
    @PatchMapping("/users/{id}/staff")
    public Map<String, Object> staff(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return admin.updateStaff(auth.authenticate(request, false), id, body, RequestIdFilter.currentRequestId(request));
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
