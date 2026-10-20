package com.lulu.campusmarketbackend.security;

import com.lulu.campusmarketbackend.api.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * 阶段 4：用户发布文本的内容安全（商品标题与描述、留言、私信、昵称、圈子名称与简介、教材建议的自由文本）。
 *
 * <ol>
 *   <li><b>关键词过滤</b>（始终生效）：内置一份最小的违禁交易词表，可用 {@code campus-market.content-safety.keywords-file}
 *       追加（每行一个词，# 开头为注释）。比对前统一大小写、全半角并去掉空白与标点，挡住「代 考」「代-考」之类的简单拆分；</li>
 *   <li><b>微信内容安全</b>（配置 AppID / AppSecret 且用户已绑定微信时）：msg_sec_check v2。risky 拒绝；review 放行但记录；
 *       微信不可用时放行并记录告警——关键词过滤仍然生效，平台举报与工作人员处理是兜底。</li>
 * </ol>
 * 拦截与待复核只在 content_safety_events 里记录原因与文本指纹，不保存原文；日志里也不出现原文。
 */
@Service
public class ContentSafetyService {
    public enum Scene {
        PRODUCT(3), COMMENT(2), MESSAGE(4), PROFILE(1), CIRCLE(3),
        /** 教材建议的书名、作者、出版社、版次与备注（V20 放开 content_safety_events.scene 的取值） */
        TEXTBOOK_SUGGESTION(3);
        final int wechatScene;
        Scene(int wechatScene) { this.wechatScene = wechatScene; }
    }

    static final String BLOCKED_MESSAGE = "内容可能包含违规信息，请修改后再提交";
    private static final Logger LOG = LoggerFactory.getLogger(ContentSafetyService.class);
    /** 校园二手平台明确不允许出现的交易：代考代写、证件、管制物品、药品与成瘾品、账号与考试作弊、赌博等。只放短而明确的词，避免误伤。 */
    private static final List<String> BUILT_IN = List.of(
            "代考", "替考", "代写论文", "论文代写", "代写作业", "考试答案", "四六级答案", "作弊器", "作弊耳机",
            "办证", "假证", "代办证件", "身份证出售", "学生证出售", "银行卡出售", "收购银行卡", "出租银行卡",
            "枪支", "仿真枪", "气枪", "弩箭", "管制刀具", "电击器", "迷药", "催情药", "听话水",
            "冰毒", "摇头丸", "处方药出售", "代孕", "卖卵", "赌博", "博彩", "网赌", "裸聊", "援交",
            "刷单", "套现", "裸贷", "校园贷");

    private final JdbcTemplate jdbc;
    private final WeChatClient wechat;
    private final List<String> keywords;
    /** 事件在独立事务里写入：业务随后抛出 400 回滚时，拦截记录仍然保留 */
    private final TransactionTemplate independent;

    public ContentSafetyService(JdbcTemplate jdbc, WeChatClient wechat, PlatformTransactionManager transactions,
                                @Value("${campus-market.content-safety.keywords-file:}") String keywordsFile) {
        this.jdbc = jdbc;
        this.wechat = wechat;
        this.independent = new TransactionTemplate(transactions);
        this.independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        List<String> all = new ArrayList<>();
        for (String word : BUILT_IN) all.add(normalize(word));
        if (keywordsFile != null && !keywordsFile.isBlank()) {
            try {
                for (String line : Files.readAllLines(Path.of(keywordsFile), StandardCharsets.UTF_8)) {
                    String word = normalize(line.strip());
                    if (!word.isEmpty() && !line.strip().startsWith("#")) all.add(word);
                }
            } catch (IOException e) {
                throw new UncheckedIOException("内容安全词表不可读：" + keywordsFile, e);
            }
        }
        this.keywords = List.copyOf(all);
    }

    /** 已登录用户的文本。拦截时记录事件（独立事务，不随业务回滚）并抛出 400。 */
    public void check(UUID user, Scene scene, String... texts) {
        String joined = String.join("\n", nonNull(texts));
        if (joined.isBlank()) return;
        String hit = keywordHit(joined);
        if (hit != null) {
            record(user, scene, "KEYWORD", "BLOCKED", "keyword", joined);
            throw ApiException.badRequest(BLOCKED_MESSAGE);
        }
        if (!wechat.enabled()) return;
        List<String> openid = jdbc.queryForList("SELECT openid FROM user_wechat_identities WHERE user_id=?", String.class, user);
        if (openid.isEmpty()) return;
        WeChatClient.SecurityResult result = wechat.msgSecCheck(openid.get(0), scene.wechatScene, joined);
        switch (result.verdict()) {
            case RISKY -> {
                record(user, scene, "WECHAT", "BLOCKED", result.label(), joined);
                throw ApiException.badRequest(BLOCKED_MESSAGE);
            }
            case REVIEW -> record(user, scene, "WECHAT", "REVIEW", result.label(), joined);
            case UNAVAILABLE -> LOG.warn("content safety check unavailable scene={} reason={}", scene, result.label());
            default -> { }
        }
    }

    /** 还没有账号时（注册昵称）：只做关键词过滤，不记录事件。 */
    public void checkAnonymous(String... texts) {
        if (keywordHit(String.join("\n", nonNull(texts))) != null) throw ApiException.badRequest(BLOCKED_MESSAGE);
    }

    String keywordHit(String text) {
        String normalized = normalize(text);
        for (String word : keywords) if (!word.isEmpty() && normalized.contains(word)) return word;
        return null;
    }

    static String normalize(String text) {
        String folded = Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        // 去掉空白、标点与符号：挡住「代 考」「代-考」「代·考」这类拆分
        return folded.replaceAll("[\\s\\p{P}\\p{S}]+", "");
    }

    private void record(UUID user, Scene scene, String provider, String verdict, String label, String text) {
        independent.executeWithoutResult(status -> jdbc.update(
                "INSERT INTO content_safety_events(user_id, scene, provider, verdict, label, text_sha256) VALUES (?,?,?,?,?,?)",
                user, scene.name(), provider, verdict, label.length() > 64 ? label.substring(0, 64) : label, sha256(text)));
    }

    private static List<String> nonNull(String... texts) {
        List<String> result = new ArrayList<>();
        for (String text : texts) if (text != null) result.add(text);
        return result;
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
