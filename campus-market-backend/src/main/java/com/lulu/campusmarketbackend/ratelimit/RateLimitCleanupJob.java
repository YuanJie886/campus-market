package com.lulu.campusmarketbackend.ratelimit;

import com.lulu.campusmarketbackend.mapper.RateLimitMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 定期删除已过期的限流计数行。
 *
 * <p>与 {@code OrderExpiryJob} 职责完全分开：那个处理订单业务超时，这个只做基础设施清理。
 *
 * <p>整个 Bean 由 {@code campus-market.rate-limit.cleanup-enabled} 条件装配，
 * 关闭时 Bean 不创建、{@code @Scheduled} 不注册，因此不会有定时线程去建连接或开事务。
 * 刻意不用「方法体开头 if (!enabled) return」——那样事务代理会在 guard 之前就切入。
 */
@Component
@ConditionalOnProperty(name = "campus-market.rate-limit.cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class RateLimitCleanupJob {

    private final RateLimitMapper counters;

    public RateLimitCleanupJob(RateLimitMapper counters) {
        this.counters = counters;
    }

    /** 每 5 分钟清理一次。不记录任何主体摘要。 */
    @Scheduled(fixedDelay = 300_000)
    @Transactional
    public void purgeExpired() {
        counters.deleteExpired();
    }
}
