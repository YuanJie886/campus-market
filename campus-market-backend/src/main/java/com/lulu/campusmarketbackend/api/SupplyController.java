package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.supply.AssistInviteService;
import com.lulu.campusmarketbackend.supply.ListingBatchService;
import com.lulu.campusmarketbackend.supply.ListingDraftService;
import com.lulu.campusmarketbackend.supply.PriceGuidanceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 毕业季通用供给引擎（模块 5）：发布草稿、批量发布、整套打包、协助整理发布、历史成交价格参考。
 * 全部需要登录；身份只取自认证，请求体或路径里的任何 ownerId / sellerId 都不会被采信。
 */
@RestController
@RequestMapping("/v1")
public class SupplyController {
    private final AuthService auth;
    private final ListingDraftService drafts;
    private final ListingBatchService batches;
    private final AssistInviteService invites;
    private final PriceGuidanceService priceGuidance;

    public SupplyController(AuthService auth, ListingDraftService drafts, ListingBatchService batches,
                            AssistInviteService invites, PriceGuidanceService priceGuidance) {
        this.auth = auth; this.drafts = drafts; this.batches = batches; this.invites = invites; this.priceGuidance = priceGuidance;
    }

    // ---------------- 草稿 ----------------
    @PostMapping("/listing-drafts")
    public Map<String, Object> createDraft(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return drafts.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/listing-drafts")
    public List<Map<String, Object>> drafts(HttpServletRequest request) {
        return drafts.mine(auth.authenticate(request, false));
    }
    /** 我作为协助人可以编辑的草稿。放在 /{id} 之前声明只是为了可读性，Spring 按字面路径优先匹配。 */
    @GetMapping("/listing-drafts/assisting")
    public List<Map<String, Object>> assistingDrafts(HttpServletRequest request) {
        return drafts.assisting(auth.authenticate(request, false));
    }
    @GetMapping("/listing-drafts/{id}")
    public Map<String, Object> draft(HttpServletRequest request, @PathVariable String id) {
        return drafts.get(auth.authenticate(request, false), id);
    }
    @PatchMapping("/listing-drafts/{id}")
    public Map<String, Object> updateDraft(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body,
                                           @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        return drafts.update(auth.authenticate(request, false), id, body, ifMatch);
    }
    @DeleteMapping("/listing-drafts/{id}")
    public Map<String, Object> discardDraft(HttpServletRequest request, @PathVariable String id) {
        return drafts.discard(auth.authenticate(request, false), id);
    }

    // ---------------- 批次 ----------------
    @PostMapping("/listing-batches")
    public Map<String, Object> createBatch(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return batches.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/listing-batches")
    public List<Map<String, Object>> batches(HttpServletRequest request) {
        return batches.mine(auth.authenticate(request, false));
    }
    @GetMapping("/listing-batches/{id}")
    public Map<String, Object> batch(HttpServletRequest request, @PathVariable String id) {
        return batches.detail(auth.authenticate(request, false), id);
    }
    @PatchMapping("/listing-batches/{id}")
    public Map<String, Object> updateBatch(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body,
                                           @RequestHeader(value = "If-Match", required = false) String ifMatch) {
        return batches.update(auth.authenticate(request, false), id, body, ifMatch);
    }
    @DeleteMapping("/listing-batches/{id}")
    public Map<String, Object> discardBatch(HttpServletRequest request, @PathVariable String id) {
        return batches.discard(auth.authenticate(request, false), id);
    }
    /** 整批发布：全部成功或全部不发布。幂等键只从请求头读取。 */
    @PostMapping("/listing-batches/{id}/publish")
    public Map<String, Object> publishBatch(HttpServletRequest request, @PathVariable String id,
                                            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return batches.publish(auth.authenticate(request, false), id, idempotencyKey);
    }

    // ---------------- 协助整理发布 ----------------
    @PostMapping("/listing-assist-invites")
    public Map<String, Object> createInvite(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return invites.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/listing-assist-invites")
    public List<Map<String, Object>> invites(HttpServletRequest request) {
        return invites.mine(auth.authenticate(request, false));
    }
    /** 兑换：邀请码只出现在请求体里，永远不进入路径或 query。 */
    @PostMapping("/listing-assist-invites/redeem")
    public Map<String, Object> redeemInvite(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return invites.redeem(auth.authenticate(request, false), body);
    }
    @PostMapping("/listing-assist-invites/{id}/revoke")
    public Map<String, Object> revokeInvite(HttpServletRequest request, @PathVariable String id) {
        return invites.revoke(auth.authenticate(request, false), id);
    }
    @GetMapping("/listing-assist-invites/{id}/events")
    public List<Map<String, Object>> inviteEvents(HttpServletRequest request, @PathVariable String id) {
        return invites.events(auth.authenticate(request, false), id);
    }

    // ---------------- 价格参考 ----------------

}
