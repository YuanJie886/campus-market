package com.lulu.campusmarketbackend.ratelimit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 限流阈值配置。全部来自 application.yaml，非法值（非正数）在启动时即失败。
 */
@Component
public class RateLimitProperties {

    /** 单条规则：窗口内允许的请求数与窗口长度。 */
    public record Rule(int limit, int windowSeconds) {}

    private final Rule login;
    private final Rule register;
    private final Rule refresh;
    private final Rule textbookSuggestion;
    private final Rule draftCreate;
    private final Rule batchPublish;
    private final Rule inviteCreate;
    private final Rule inviteRedeem;
    private final Rule circleCreate;
    private final Rule circleInviteCreate;
    private final Rule circleInviteRedeem;
    private final Rule moderationReport;
    private final Rule appealSubmit;
    private final Rule contactRequest;
    private final Rule adminRead;
    private final Rule adminWrite;
    private final Rule accountSecurity;
    private final Rule passwordReset;
    private final Rule wechatLogin;
    private final Rule imageUpload;

    public RateLimitProperties(
            @Value("${campus-market.rate-limit.login.limit}") int loginLimit,
            @Value("${campus-market.rate-limit.login.window-seconds}") int loginWindow,
            @Value("${campus-market.rate-limit.register.limit}") int registerLimit,
            @Value("${campus-market.rate-limit.register.window-seconds}") int registerWindow,
            @Value("${campus-market.rate-limit.refresh.limit}") int refreshLimit,
            @Value("${campus-market.rate-limit.refresh.window-seconds}") int refreshWindow,
            @Value("${campus-market.rate-limit.textbook-suggestion.limit:10}") int suggestionLimit,
            @Value("${campus-market.rate-limit.textbook-suggestion.window-seconds:86400}") int suggestionWindow,
            @Value("${campus-market.rate-limit.listing-draft-create.limit:120}") int draftLimit,
            @Value("${campus-market.rate-limit.listing-draft-create.window-seconds:3600}") int draftWindow,
            @Value("${campus-market.rate-limit.listing-batch-publish.limit:30}") int publishLimit,
            @Value("${campus-market.rate-limit.listing-batch-publish.window-seconds:3600}") int publishWindow,
            @Value("${campus-market.rate-limit.assist-invite-create.limit:20}") int inviteLimit,
            @Value("${campus-market.rate-limit.assist-invite-create.window-seconds:86400}") int inviteWindow,
            @Value("${campus-market.rate-limit.assist-invite-redeem.limit:10}") int redeemLimit,
            @Value("${campus-market.rate-limit.assist-invite-redeem.window-seconds:600}") int redeemWindow,
            @Value("${campus-market.rate-limit.circle-create.limit:10}") int circleLimit,
            @Value("${campus-market.rate-limit.circle-create.window-seconds:86400}") int circleWindow,
            @Value("${campus-market.rate-limit.circle-invite-create.limit:30}") int circleInviteLimit,
            @Value("${campus-market.rate-limit.circle-invite-create.window-seconds:86400}") int circleInviteWindow,
            @Value("${campus-market.rate-limit.circle-invite-redeem.limit:10}") int circleRedeemLimit,
            @Value("${campus-market.rate-limit.circle-invite-redeem.window-seconds:600}") int circleRedeemWindow,
            @Value("${campus-market.rate-limit.moderation-report.limit:20}") int reportLimit,
            @Value("${campus-market.rate-limit.moderation-report.window-seconds:86400}") int reportWindow,
            @Value("${campus-market.rate-limit.appeal-submit.limit:5}") int appealLimit,
            @Value("${campus-market.rate-limit.appeal-submit.window-seconds:86400}") int appealWindow,
            @Value("${campus-market.rate-limit.contact-request.limit:20}") int contactLimit,
            @Value("${campus-market.rate-limit.contact-request.window-seconds:3600}") int contactWindow,
            @Value("${campus-market.rate-limit.admin-read.limit:300}") int adminReadLimit,
            @Value("${campus-market.rate-limit.admin-read.window-seconds:600}") int adminReadWindow,
            @Value("${campus-market.rate-limit.admin-write.limit:60}") int adminWriteLimit,
            @Value("${campus-market.rate-limit.admin-write.window-seconds:600}") int adminWriteWindow,
            @Value("${campus-market.rate-limit.account-security.limit:10}") int accountLimit,
            @Value("${campus-market.rate-limit.account-security.window-seconds:3600}") int accountWindow,
            @Value("${campus-market.rate-limit.password-reset.limit:10}") int resetLimit,
            @Value("${campus-market.rate-limit.password-reset.window-seconds:3600}") int resetWindow,
            @Value("${campus-market.rate-limit.wechat-login.limit:600}") int wechatLimit,
            @Value("${campus-market.rate-limit.wechat-login.window-seconds:60}") int wechatWindow,
            @Value("${campus-market.rate-limit.image-upload.limit:60}") int imageLimit,
            @Value("${campus-market.rate-limit.image-upload.window-seconds:3600}") int imageWindow) {
        this.login = rule("login", loginLimit, loginWindow);
        this.register = rule("register", registerLimit, registerWindow);
        this.refresh = rule("refresh", refreshLimit, refreshWindow);
        this.textbookSuggestion = rule("textbook-suggestion", suggestionLimit, suggestionWindow);
        this.draftCreate = rule("listing-draft-create", draftLimit, draftWindow);
        this.batchPublish = rule("listing-batch-publish", publishLimit, publishWindow);
        this.inviteCreate = rule("assist-invite-create", inviteLimit, inviteWindow);
        this.inviteRedeem = rule("assist-invite-redeem", redeemLimit, redeemWindow);
        this.circleCreate = rule("circle-create", circleLimit, circleWindow);
        this.circleInviteCreate = rule("circle-invite-create", circleInviteLimit, circleInviteWindow);
        this.circleInviteRedeem = rule("circle-invite-redeem", circleRedeemLimit, circleRedeemWindow);
        this.moderationReport = rule("moderation-report", reportLimit, reportWindow);
        this.appealSubmit = rule("appeal-submit", appealLimit, appealWindow);
        this.contactRequest = rule("contact-request", contactLimit, contactWindow);
        this.adminRead = rule("admin-read", adminReadLimit, adminReadWindow);
        this.adminWrite = rule("admin-write", adminWriteLimit, adminWriteWindow);
        this.accountSecurity = rule("account-security", accountLimit, accountWindow);
        this.passwordReset = rule("password-reset", resetLimit, resetWindow);
        this.wechatLogin = rule("wechat-login", wechatLimit, wechatWindow);
        this.imageUpload = rule("image-upload", imageLimit, imageWindow);
    }

    public Rule ruleOf(RateLimitService.Scope scope) {
        return switch (scope) {
            case AUTH_LOGIN -> login;
            case AUTH_REGISTER -> register;
            case AUTH_REFRESH -> refresh;
            case TEXTBOOK_SUGGESTION -> textbookSuggestion;
            case LISTING_DRAFT_CREATE -> draftCreate;
            case LISTING_BATCH_PUBLISH -> batchPublish;
            case ASSIST_INVITE_CREATE -> inviteCreate;
            case ASSIST_INVITE_REDEEM -> inviteRedeem;
            case CIRCLE_CREATE -> circleCreate;
            case CIRCLE_INVITE_CREATE -> circleInviteCreate;
            case CIRCLE_INVITE_REDEEM -> circleInviteRedeem;
            case MODERATION_REPORT -> moderationReport;
            case APPEAL_SUBMIT -> appealSubmit;
            case CONTACT_REQUEST -> contactRequest;
            case ADMIN_READ -> adminRead;
            case ADMIN_WRITE -> adminWrite;
            case ACCOUNT_SECURITY -> accountSecurity;
            case PASSWORD_RESET -> passwordReset;
            case WECHAT_LOGIN -> wechatLogin;
            case IMAGE_UPLOAD -> imageUpload;
        };
    }

    private static Rule rule(String name, int limit, int windowSeconds) {
        if (limit <= 0 || windowSeconds <= 0) {
            throw new IllegalStateException(
                    "campus-market.rate-limit." + name + " 的 limit 与 window-seconds 必须为正数");
        }
        return new Rule(limit, windowSeconds);
    }
}
