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
    private final Rule confirmationCode;
    private final Rule textbookSuggestion;
    private final Rule draftCreate;
    private final Rule batchPublish;
    private final Rule inviteCreate;
    private final Rule inviteRedeem;
    private final Rule priceGuidance;
    private final Rule circleCreate;
    private final Rule circleInviteCreate;
    private final Rule circleInviteRedeem;
    private final Rule moderationReport;
    private final Rule noShowReport;
    private final Rule appealSubmit;

    public RateLimitProperties(
            @Value("${campus-market.rate-limit.login.limit}") int loginLimit,
            @Value("${campus-market.rate-limit.login.window-seconds}") int loginWindow,
            @Value("${campus-market.rate-limit.register.limit}") int registerLimit,
            @Value("${campus-market.rate-limit.register.window-seconds}") int registerWindow,
            @Value("${campus-market.rate-limit.refresh.limit}") int refreshLimit,
            @Value("${campus-market.rate-limit.refresh.window-seconds}") int refreshWindow,
            @Value("${campus-market.rate-limit.confirmation-code.limit}") int codeLimit,
            @Value("${campus-market.rate-limit.confirmation-code.window-seconds}") int codeWindow,
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
            @Value("${campus-market.rate-limit.price-guidance.limit:60}") int guidanceLimit,
            @Value("${campus-market.rate-limit.price-guidance.window-seconds:600}") int guidanceWindow,
            @Value("${campus-market.rate-limit.circle-create.limit:10}") int circleLimit,
            @Value("${campus-market.rate-limit.circle-create.window-seconds:86400}") int circleWindow,
            @Value("${campus-market.rate-limit.circle-invite-create.limit:30}") int circleInviteLimit,
            @Value("${campus-market.rate-limit.circle-invite-create.window-seconds:86400}") int circleInviteWindow,
            @Value("${campus-market.rate-limit.circle-invite-redeem.limit:10}") int circleRedeemLimit,
            @Value("${campus-market.rate-limit.circle-invite-redeem.window-seconds:600}") int circleRedeemWindow,
            @Value("${campus-market.rate-limit.moderation-report.limit:20}") int reportLimit,
            @Value("${campus-market.rate-limit.moderation-report.window-seconds:86400}") int reportWindow,
            @Value("${campus-market.rate-limit.no-show-report.limit:10}") int noShowLimit,
            @Value("${campus-market.rate-limit.no-show-report.window-seconds:86400}") int noShowWindow,
            @Value("${campus-market.rate-limit.appeal-submit.limit:5}") int appealLimit,
            @Value("${campus-market.rate-limit.appeal-submit.window-seconds:86400}") int appealWindow) {
        this.login = rule("login", loginLimit, loginWindow);
        this.register = rule("register", registerLimit, registerWindow);
        this.refresh = rule("refresh", refreshLimit, refreshWindow);
        this.confirmationCode = rule("confirmation-code", codeLimit, codeWindow);
        this.textbookSuggestion = rule("textbook-suggestion", suggestionLimit, suggestionWindow);
        this.draftCreate = rule("listing-draft-create", draftLimit, draftWindow);
        this.batchPublish = rule("listing-batch-publish", publishLimit, publishWindow);
        this.inviteCreate = rule("assist-invite-create", inviteLimit, inviteWindow);
        this.inviteRedeem = rule("assist-invite-redeem", redeemLimit, redeemWindow);
        this.priceGuidance = rule("price-guidance", guidanceLimit, guidanceWindow);
        this.circleCreate = rule("circle-create", circleLimit, circleWindow);
        this.circleInviteCreate = rule("circle-invite-create", circleInviteLimit, circleInviteWindow);
        this.circleInviteRedeem = rule("circle-invite-redeem", circleRedeemLimit, circleRedeemWindow);
        this.moderationReport = rule("moderation-report", reportLimit, reportWindow);
        this.noShowReport = rule("no-show-report", noShowLimit, noShowWindow);
        this.appealSubmit = rule("appeal-submit", appealLimit, appealWindow);
    }

    public Rule ruleOf(RateLimitService.Scope scope) {
        return switch (scope) {
            case AUTH_LOGIN -> login;
            case AUTH_REGISTER -> register;
            case AUTH_REFRESH -> refresh;
            case ORDER_CONFIRMATION_CODE -> confirmationCode;
            case TEXTBOOK_SUGGESTION -> textbookSuggestion;
            case LISTING_DRAFT_CREATE -> draftCreate;
            case LISTING_BATCH_PUBLISH -> batchPublish;
            case ASSIST_INVITE_CREATE -> inviteCreate;
            case ASSIST_INVITE_REDEEM -> inviteRedeem;
            case PRICE_GUIDANCE -> priceGuidance;
            case CIRCLE_CREATE -> circleCreate;
            case CIRCLE_INVITE_CREATE -> circleInviteCreate;
            case CIRCLE_INVITE_REDEEM -> circleInviteRedeem;
            case MODERATION_REPORT -> moderationReport;
            case NO_SHOW_REPORT -> noShowReport;
            case APPEAL_SUBMIT -> appealSubmit;
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
