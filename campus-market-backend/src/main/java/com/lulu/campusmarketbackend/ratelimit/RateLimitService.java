package com.lulu.campusmarketbackend.ratelimit;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.RateLimitMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;

/**
 * 主体维度的固定窗口限流。
 *
 * <h2>为什么是「主体」而不是 IP</h2>
 * 本阶段刻意<b>不</b>做 IP 限流：项目尚未建立可信代理列表与 {@code X-Forwarded-For}
 * 信任模型，盲目信任该头可被任意伪造；而只用 {@code remoteAddr}，在反向代理或
 * 校园 NAT 之后会把全校用户识别成同一个地址，直接造成大面积误封。
 * 因此这里限流的是<b>业务主体</b>：账号标识、会话 id、用户 id。
 *
 * <h2>为什么用数据库</h2>
 * 计数必须在多实例间一致。单 JVM 的 {@code ConcurrentHashMap} / Guava / 单机模式
 * Bucket4j 在水平扩容后立刻失效；引入 Redis 又会带来新的部署组件。
 * PostgreSQL 的 {@code INSERT ... ON CONFLICT DO UPDATE ... RETURNING} 本身就是
 * 原子的，足以承担当前量级，且不新增运维依赖。
 *
 */
@Service
public class RateLimitService {

    /** 限流作用域。每个 scope 的计数互相独立。 */
    public enum Scope {
        AUTH_LOGIN("auth_login"),
        AUTH_REGISTER("auth_register"),
        AUTH_REFRESH("auth_refresh"),
        /** 模块 4：每个用户每日可提交的教材建议数（只计新建，幂等重复提交不计） */
        TEXTBOOK_SUGGESTION("textbook_suggestion"),
        // 模块 5：全部按登录用户计，不按 IP
        LISTING_DRAFT_CREATE("listing_draft_create"),
        LISTING_BATCH_PUBLISH("listing_batch_publish"),
        ASSIST_INVITE_CREATE("assist_invite_create"),
        /** 每一次兑换尝试都计数（成功或失败），多次错误兑换触发 429 */
        ASSIST_INVITE_REDEEM("assist_invite_redeem"),
        // 模块 6：同样按登录用户计
        CIRCLE_CREATE("circle_create"),
        CIRCLE_INVITE_CREATE("circle_invite_create"),
        /** 每一次兑换尝试都计数（成功或失败） */
        CIRCLE_INVITE_REDEEM("circle_invite_redeem"),
        // 模块 7：举报与申诉按登录用户计
        MODERATION_REPORT("moderation_report"),
        APPEAL_SUBMIT("appeal_submit"),
        /** 阶段 1：发起联系申请（新建与撤回后重新申请都计数；对同一件商品的重复请求幂等返回、不计数） */
        CONTACT_REQUEST("contact_request"),
        /** 阶段 2：运营后台按工作人员计；读取（列表、详情、导出）与写入（授权、商品管理、复核）分开计数 */
        ADMIN_READ("admin_read"),
        ADMIN_WRITE("admin_write"),
        /** 阶段 3：修改密码与注销（按用户）、重置码兑换（按账号，含错误尝试）、微信登录（全局，防止被用来放大调用微信接口） */
        ACCOUNT_SECURITY("account_security"),
        PASSWORD_RESET("password_reset"),
        WECHAT_LOGIN("wechat_login"),
        /** 阶段 4：图片上传按用户计 */
        IMAGE_UPLOAD("image_upload");

        private final String key;
        Scope(String key) { this.key = key; }
        public String key() { return key; }
    }

    private final RateLimitMapper counters;
    private final RateLimitProperties properties;

    public RateLimitService(RateLimitMapper counters, RateLimitProperties properties) {
        this.counters = counters;
        this.properties = properties;
    }

    /**
     * 消耗一次配额；超限抛 429，存储故障抛 503。
     *
     * <p><b>fail-closed 决策</b>：本服务接入登录、注册、refresh、确认码提交这四个
     * 安全敏感入口，以及模块 4 的教材建议（防止批量灌入待审核数据）。限流表不可用时若放行（fail-open），等于在数据库故障期间打开口令
     * 与确认码的无限爆破窗口——这正是限流要防的事。因此这里选择 fail-closed，
     * 返回 503 拒绝请求，而不是悄悄吞掉异常。普通非安全接口不接入本模块，
     * 不会因此受影响。
     *
     * <p><b>为什么用 {@code REQUIRES_NEW}</b>：{@code register} 与 {@code refresh} 本身带事务，
     * 它们失败时（例如账号已存在返回 409）会回滚——若计数在同一个事务里，就会被一并撤销，
     * 于是「重复注册同一账号」永远消耗不掉配额。这与 R-02 中确认码计数被回滚是同一类问题。
     *
     * <p>这里用独立事务是安全的，与 R-02 修复时刻意回避 {@code REQUIRES_NEW} 的场景不同：
     * 那里内层要更新的是外层已用 {@code FOR UPDATE} 锁住的<b>同一行 orders</b>，会自阻塞；
     * 而本方法只写 {@code rate_limit_counters}，外层业务事务从不锁这张表，不存在循环等待。
     * 代价是被限流的请求会短暂占用第二个连接池连接。
     *
     * @param subject 限流主体的原始值（账号 / sessionId / userId），只用于计算摘要，不落库
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void consume(Scope scope, String subject) {
        RateLimitProperties.Rule rule = properties.ruleOf(scope);
        Map<String, Object> result;
        try {
            result = counters.incrementAndGet(scope.key(), digest(scope, subject), rule.windowSeconds());
        } catch (RuntimeException e) {
            // 不记录 subject 或其摘要，避免把主体写进日志
            throw new ApiException(503, "服务暂时不可用，请稍后重试");
        }
        if (result == null) throw new ApiException(503, "服务暂时不可用，请稍后重试");

        int count = ((Number) result.get("count")).intValue();
        if (count > rule.limit()) {
            // 错误消息不暴露主体摘要、当前计数或数据库键
            throw new RateLimitExceededException(retryAfterSeconds(result.get("window_end")));
        }
    }

    /**
     * 归一化账号标识后再摘要：去首尾空白并转小写，
     * 使 {@code  Alice@X.com } 与 {@code alice@x.com } 落在同一个限流主体上，
     * 否则攻击者只要变换大小写就能绕开账号维度的限制。
     */
    public static String normalizeAccount(String account) {
        return account == null ? "" : account.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * 主体摘要。scope 参与摘要，使同一账号在不同 scope 下的摘要不同，
     * 避免跨 scope 的相关性分析。
     *
     * <p>再次强调：SHA-256 只保证数据库里不出现原值，对低熵主体不提供不可逆匿名化。
     */
    private static String digest(Scope scope, String subject) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update(scope.key().getBytes(StandardCharsets.UTF_8));
            sha.update((byte) 0);
            sha.update(String.valueOf(subject).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(sha.digest());
        } catch (Exception e) {
            throw new IllegalStateException("无法计算限流主体摘要", e);
        }
    }

    /** Retry-After 至少为 1 秒，避免返回 0 让客户端立刻重试。 */
    private static long retryAfterSeconds(Object windowEnd) {
        Instant end = toInstant(windowEnd);
        if (end == null) return 1;
        long seconds = end.getEpochSecond() - Instant.now().getEpochSecond();
        return Math.max(1, seconds);
    }

    private static Instant toInstant(Object value) {
        if (value instanceof Timestamp t) return t.toInstant();
        if (value instanceof OffsetDateTime odt) return odt.toInstant();
        if (value instanceof Instant i) return i;
        return null;
    }
}
