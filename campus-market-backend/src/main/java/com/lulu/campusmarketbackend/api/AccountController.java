package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.security.AccountService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 阶段 3：修改密码、凭重置码找回、注销与微信登录。 */
@RestController
@RequestMapping("/v1/auth")
public class AccountController {
    private final AccountService accounts;

    public AccountController(AccountService accounts) { this.accounts = accounts; }

    @PostMapping("/password")
    public Map<String, Object> changePassword(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return accounts.changePassword(request, body);
    }

    @PostMapping("/password-reset")
    public Map<String, Object> reset(@RequestBody Map<String, Object> body) {
        return accounts.resetWithCode(body);
    }

    @PostMapping("/me/deletion")
    public Map<String, Object> delete(HttpServletRequest request, HttpServletResponse response, @RequestBody Map<String, Object> body) {
        return accounts.deleteAccount(request, response, body, RequestIdFilter.currentRequestId(request));
    }

    @GetMapping("/wechat")
    public Map<String, Object> wechat(HttpServletRequest request) { return accounts.wechatStatus(request); }

    @PostMapping("/wechat/login")
    public Map<String, Object> wechatLogin(@RequestBody Map<String, Object> body, HttpServletResponse response) {
        return accounts.wechatLogin(body, response);
    }

    @PostMapping("/wechat/bind")
    public Map<String, Object> wechatBind(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return accounts.wechatBind(request, body);
    }

    @PostMapping("/wechat/unbind")
    public Map<String, Object> wechatUnbind(HttpServletRequest request) { return accounts.wechatUnbind(request); }
}
