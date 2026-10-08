package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.governance.ModerationService;
import com.lulu.campusmarketbackend.governance.NoShowService;
import com.lulu.campusmarketbackend.governance.StaffGuard;
import com.lulu.campusmarketbackend.governance.StaffModerationService;
import com.lulu.campusmarketbackend.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 模块 7：交易承诺与可信治理。全部需要登录；身份只取自认证。
 * 工作人员接口在 /v1/moderation/* 下，权限每次都从数据库读取，非工作人员 403、他校案件 404。
 */
@RestController
@RequestMapping("/v1")
public class GovernanceController {
    private final AuthService auth;
    private final NoShowService noShows;
    private final ModerationService moderation;
    private final StaffModerationService staffModeration;
    private final StaffGuard staff;

    public GovernanceController(AuthService auth, NoShowService noShows, ModerationService moderation,
                                StaffModerationService staffModeration, StaffGuard staff) {
        this.auth = auth;
        this.noShows = noShows;
        this.moderation = moderation;
        this.staffModeration = staffModeration;
        this.staff = staff;
    }

    // ---------------- 爽约报告（订单双方） ----------------

    @GetMapping("/orders/{id}/no-show-reports")
    public Map<String, Object> noShows(HttpServletRequest request, @PathVariable String id) {
        return noShows.view(auth.authenticate(request, false), id);
    }
    @PostMapping("/orders/{id}/no-show-reports")
    public Map<String, Object> reportNoShow(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return noShows.report(auth.authenticate(request, false), id, body);
    }
    @PostMapping("/no-show-reports/{id}/acknowledge")
    public Map<String, Object> acknowledge(HttpServletRequest request, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        return noShows.acknowledge(auth.authenticate(request, false), id, body == null ? Map.of() : body);
    }
    @PostMapping("/no-show-reports/{id}/dispute")
    public Map<String, Object> dispute(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return noShows.dispute(auth.authenticate(request, false), id, body);
    }

    // ---------------- 举报、我的限制、申诉 ----------------

    @PostMapping("/moderation-reports")
    public Map<String, Object> report(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return moderation.report(auth.authenticate(request, false), body);
    }
    @GetMapping("/moderation-reports/mine")
    public List<Map<String, Object>> myReports(HttpServletRequest request) {
        return moderation.myReports(auth.authenticate(request, false));
    }
    @GetMapping("/me/governance")
    public Map<String, Object> myGovernance(HttpServletRequest request) {
        return moderation.myGovernance(auth.authenticate(request, false));
    }
    @PostMapping("/me/appeals")
    public Map<String, Object> appeal(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return moderation.appeal(auth.authenticate(request, false), body);
    }
    @GetMapping("/me/staff")
    public Map<String, Object> staffStatus(HttpServletRequest request) {
        return staff.status(auth.authenticate(request, false));
    }

    // ---------------- 工作人员 ----------------

    @GetMapping("/moderation/cases")
    public Map<String, Object> cases(HttpServletRequest request, @RequestParam Map<String, String> query) {
        return staffModeration.list(auth.authenticate(request, false), query);
    }
    @PostMapping("/moderation/cases")
    public Map<String, Object> openCase(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return staffModeration.open(auth.authenticate(request, false), body);
    }
    @GetMapping("/moderation/cases/{id}")
    public Map<String, Object> caseDetail(HttpServletRequest request, @PathVariable String id) {
        return staffModeration.detail(auth.authenticate(request, false), id);
    }
    @PostMapping("/moderation/cases/{id}/claim")
    public Map<String, Object> claim(HttpServletRequest request, @PathVariable String id) {
        return staffModeration.claim(auth.authenticate(request, false), id);
    }
    @PostMapping("/moderation/cases/{id}/decision")
    public Map<String, Object> decide(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return withRequestId(staffModeration.decide(auth.authenticate(request, false), id, body), request);
    }
    @GetMapping("/moderation/appeals")
    public Map<String, Object> appeals(HttpServletRequest request, @RequestParam Map<String, String> query) {
        return staffModeration.appeals(auth.authenticate(request, false), query);
    }
    @PostMapping("/moderation/appeals/{id}/decision")
    public Map<String, Object> decideAppeal(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return withRequestId(staffModeration.decideAppeal(auth.authenticate(request, false), id, body), request);
    }

    /** 管理动作的结果带上本次请求的 requestId，工作人员界面据此显示可追溯的操作编号。 */
    private static Map<String, Object> withRequestId(Map<String, Object> result, HttpServletRequest request) {
        Map<String, Object> copy = new java.util.LinkedHashMap<>(result);
        copy.put("requestId", RequestIdFilter.currentRequestId(request));
        return copy;
    }
}
