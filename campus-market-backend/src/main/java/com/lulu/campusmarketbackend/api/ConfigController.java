package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.image.ImagePolicy;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 公开的客户端配置（不需要登录，普通信封）。客户端据此决定上传前的检查与是否显示「粘贴图片链接」，
 * 数值与服务端校验读同一组常量 / 配置（{@link ImagePolicy}），不会出现两边不一致。
 */
@RestController
@RequestMapping("/v1")
public class ConfigController {
    private final ImagePolicy images;

    public ConfigController(ImagePolicy images) { this.images = images; }

    @GetMapping("/config")
    public Map<String, Object> config() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("images", images.publicConfig());
        return result;
    }
}
