package com.lulu.campusmarketbackend.messaging;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 私信快捷消息（预设文案）的唯一定义处。
 *
 * <p>早期私信需要人工审核，默认只允许发送这里的预设消息（见 {@link MessagingPolicy}）。
 * GET /v1/message-templates 按本列表的顺序原样返回；发送时按 code 查到文案后存入 messages.content，
 * code 存入 messages.template_code。文案固定，不走内容安全检查。
 *
 * <p>新增或修改文案只改这里（客户端从接口读取，不要在客户端硬编码）。已发送消息存的是当时的文案，
 * 改文案不会改历史消息；删除某个 code 后，历史消息照常显示，只是不能再发送。
 */
public final class MessageTemplates {
    /** 谁可以发送：买家（会话发起人）、卖家，或双方都可以。 */
    public enum Role { BUYER, SELLER, ANY }

    public record Template(String code, String text, Role role) {
        public boolean allowedFor(Role sender) { return role == Role.ANY || role == sender; }
        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("code", code);
            m.put("text", text);
            m.put("role", role.name());
            return m;
        }
    }

    public static final List<Template> ALL = List.of(
            new Template("BUYER_STILL_AVAILABLE", "你好，这件还在吗？", Role.BUYER),
            new Template("BUYER_ASK_CONDITION", "可以再介绍一下成色和使用情况吗？", Role.BUYER),
            new Template("BUYER_ASK_PRICE", "价格还有商量的空间吗？", Role.BUYER),
            new Template("BUYER_ASK_PHOTOS", "方便在商品里补充几张实物照片吗？", Role.BUYER),
            new Template("BUYER_ASK_CONTACT", "我想要这件，已在商品页申请联系方式，麻烦同意一下。", Role.BUYER),
            new Template("SELLER_AVAILABLE", "还在的，可以在商品页申请联系方式。", Role.SELLER),
            new Template("SELLER_SOLD", "不好意思，已经出了。", Role.SELLER),
            new Template("SELLER_PRICE_FIRM", "价格不议，谢谢理解。", Role.SELLER),
            new Template("SELLER_PRICE_NEGOTIABLE", "价格可以商量，交换联系方式后细聊。", Role.SELLER),
            new Template("SELLER_CONTACT_VIA_REQUEST", "请在商品页点「申请联系方式」，我同意后你就能看到。", Role.SELLER),
            new Template("SELLER_PHOTOS_ADDED", "照片已补充，刷新商品页就能看到。", Role.SELLER),
            new Template("ANY_THANKS", "好的，谢谢！", Role.ANY),
            new Template("ANY_LATER", "稍等，我晚点回复你。", Role.ANY));

    private static final Map<String, Template> BY_CODE;
    static {
        Map<String, Template> byCode = new LinkedHashMap<>();
        for (Template t : ALL) {
            if (byCode.put(t.code(), t) != null) throw new IllegalStateException("duplicate message template " + t.code());
        }
        BY_CODE = java.util.Collections.unmodifiableMap(byCode);
    }

    private MessageTemplates() {}

    public static Optional<Template> find(String code) { return Optional.ofNullable(code == null ? null : BY_CODE.get(code)); }

    public static List<Map<String, Object>> toJson() { return ALL.stream().map(Template::toJson).toList(); }
}
