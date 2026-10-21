package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.messaging.MessagingPolicy;
import com.lulu.campusmarketbackend.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 私信快捷消息列表（需要登录）。文案与顺序来自 MessageTemplates，客户端不要硬编码。 */
@RestController
@RequestMapping("/v1")
public class MessageTemplateController {
    private final AuthService auth;
    private final MessagingPolicy messaging;

    public MessageTemplateController(AuthService auth, MessagingPolicy messaging) { this.auth = auth; this.messaging = messaging; }

    @GetMapping("/message-templates")
    public Map<String, Object> templates(HttpServletRequest request) {
        auth.authenticate(request, false);
        return messaging.templates();
    }
}
