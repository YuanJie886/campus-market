package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.circle.CircleService;
import com.lulu.campusmarketbackend.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 模块 6：圈子集市。全部需要登录；学校只由登录用户推导，角色 / 学校 / ownerId / status 等服务端字段不接受客户端提交。
 * 圈子 id 只出现在路径里（资源标识），圈子名称与成员资格从不进入 URL query。
 */
@RestController
@RequestMapping("/v1")
public class CircleController {
    private final AuthService auth;
    private final CircleService circles;

    public CircleController(AuthService auth, CircleService circles) {
        this.auth = auth;
        this.circles = circles;
    }

    @PostMapping("/circles")
    public Map<String, Object> create(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return circles.create(auth.authenticate(request, false), body);
    }
    @GetMapping("/circles/mine")
    public List<Map<String, Object>> mine(HttpServletRequest request) {
        return circles.mine(auth.authenticate(request, false));
    }
    @GetMapping("/circles/discover")
    public List<Map<String, Object>> discover(HttpServletRequest request, @RequestParam(value = "q", required = false) String q) {
        return circles.discover(auth.authenticate(request, false), q);
    }
    @GetMapping("/circles/{id}")
    public Map<String, Object> circle(HttpServletRequest request, @PathVariable String id) {
        return circles.get(auth.authenticate(request, false), id);
    }
    @PatchMapping("/circles/{id}")
    public Map<String, Object> update(HttpServletRequest request, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return circles.update(auth.authenticate(request, false), id, body);
    }
    @PostMapping("/circles/{id}/archive")
    public Map<String, Object> archive(HttpServletRequest request, @PathVariable String id) {
        return circles.archive(auth.authenticate(request, false), id);
    }
    /** 圈子商品流（仅在籍成员）。 */
    @GetMapping("/circles/{id}/products")
    public Map<String, Object> products(HttpServletRequest request, @PathVariable String id, @RequestParam Map<String, String> query) {
        return circles.products(auth.authenticate(request, false), id, query);
    }

    @PostMapping("/circles/{id}/invites")
    public Map<String, Object> createInvite(HttpServletRequest request, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        return circles.createInvite(auth.authenticate(request, false), id, body == null ? Map.of() : body);
    }
    @GetMapping("/circles/{id}/invites")
    public List<Map<String, Object>> invites(HttpServletRequest request, @PathVariable String id) {
        return circles.invites(auth.authenticate(request, false), id);
    }
    /** 邀请码只放在请求体里。 */
    @PostMapping("/circle-invites/redeem")
    public Map<String, Object> redeem(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return circles.redeem(auth.authenticate(request, false), body);
    }
    @PostMapping("/circle-invites/{id}/revoke")
    public Map<String, Object> revokeInvite(HttpServletRequest request, @PathVariable String id) {
        return circles.revokeInvite(auth.authenticate(request, false), id);
    }

    @GetMapping("/circles/{id}/members")
    public Map<String, Object> members(HttpServletRequest request, @PathVariable String id,
                                       @RequestParam(value = "page", required = false) String page,
                                       @RequestParam(value = "size", required = false) String size) {
        return circles.members(auth.authenticate(request, false), id, page, size);
    }
    @PatchMapping("/circles/{id}/members/{userId}")
    public Map<String, Object> changeRole(HttpServletRequest request, @PathVariable String id, @PathVariable String userId,
                                                @RequestBody Map<String, Object> body) {
        return circles.changeRole(auth.authenticate(request, false), id, userId, body);
    }
    /** 删除自己即退出；删除他人即移除。 */
    @DeleteMapping("/circles/{id}/members/{userId}")
    public Map<String, Object> removeMember(HttpServletRequest request, @PathVariable String id, @PathVariable String userId) {
        return circles.removeMember(auth.authenticate(request, false), id, userId);
    }
}
