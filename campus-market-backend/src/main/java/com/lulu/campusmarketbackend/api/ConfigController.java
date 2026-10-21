package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.image.ImagePolicy;
import com.lulu.campusmarketbackend.messaging.MessagingPolicy;
import com.lulu.campusmarketbackend.registration.RegistrationInvites;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 公开的客户端配置（不需要登录，普通信封）。客户端据此决定上传前的检查与是否显示「粘贴图片链接」，
 * 数值与服务端校验读同一组常量 / 配置（{@link ImagePolicy}、{@link MessagingPolicy}），不会出现两边不一致。
 * messages.freeTextEnabled：私信是否允许自由文字（默认 false，只能发快捷消息）。
 * registration.inviteRequired：注册是否必须填写邀请码（REGISTRATION_INVITE_REQUIRED，默认 false），见 docs/registration-invites.md。
 */
@RestController
@RequestMapping("/v1")
public class ConfigController {
    private final ImagePolicy images;
    private final MessagingPolicy messaging;
    private final RegistrationInvites invites;

    public ConfigController(ImagePolicy images, MessagingPolicy messaging, RegistrationInvites invites) {
        this.images = images; this.messaging = messaging; this.invites = invites;
    }

    @GetMapping("/config")
    public Map<String, Object> config() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("images", images.publicConfig());
        result.put("messages", messaging.publicConfig());
        result.put("registration", invites.publicConfig());
        return result;
    }
}
