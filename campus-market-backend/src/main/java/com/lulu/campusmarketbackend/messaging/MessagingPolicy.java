package com.lulu.campusmarketbackend.messaging;

import com.lulu.campusmarketbackend.api.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 私信发送规则：默认只能发 {@link MessageTemplates} 里的快捷消息；
 * {@code campus-market.messages.free-text-enabled=true}（环境变量 MESSAGES_FREE_TEXT_ENABLED）时才允许自由文字。
 * 商品留言不受影响（始终是自由文字 + 内容安全 + 举报 / 隐藏）。见 docs/messaging.md。
 */
@Component
public class MessagingPolicy {
    public static final String TEMPLATE_NOT_FOUND = "快捷消息不存在";
    public static final String TEMPLATE_WRONG_ROLE = "这条快捷消息不能由你发送";
    public static final String FREE_TEXT_DISABLED = "私信目前只能发送预设的快捷消息";
    public static final String BOTH_FIELDS = "只能二选一：快捷消息或文字";
    public static final String TEMPLATE_REQUIRED = "请选择一条快捷消息";

    private final boolean freeTextEnabled;

    public MessagingPolicy(@Value("${campus-market.messages.free-text-enabled:false}") boolean freeTextEnabled) {
        this.freeTextEnabled = freeTextEnabled;
    }

    public boolean freeTextEnabled() { return freeTextEnabled; }

    /** GET /v1/config 的 messages 部分。 */
    public Map<String, Object> publicConfig() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("freeTextEnabled", freeTextEnabled);
        return m;
    }

    /** GET /v1/message-templates 的 data。 */
    public Map<String, Object> templates() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("freeTextEnabled", freeTextEnabled);
        m.put("templates", MessageTemplates.toJson());
        return m;
    }

    /**
     * 解析发送请求体（字段白名单之后、任何读写之前调用）。返回快捷消息；返回 null 表示这是一条自由文字消息
     * （只在开关打开时出现，正文由调用方按原规则校验并做内容安全检查）。
     */
    public MessageTemplates.Template resolve(Map<String, Object> body) {
        boolean hasContent = body != null && body.containsKey("content");
        boolean hasTemplate = body != null && body.containsKey("templateCode");
        if (!freeTextEnabled) {
            if (hasContent) throw ApiException.badRequest(FREE_TEXT_DISABLED);
            if (!hasTemplate) throw ApiException.badRequest(TEMPLATE_REQUIRED);
        } else {
            if (hasContent && hasTemplate) throw ApiException.badRequest(BOTH_FIELDS);
            if (!hasTemplate) return null;
        }
        Object code = body.get("templateCode");
        return MessageTemplates.find(code instanceof String s ? s : null)
                .orElseThrow(() -> ApiException.badRequest(TEMPLATE_NOT_FOUND));
    }
}
