package com.lulu.campusmarketbackend.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 订单超时清扫的定时入口。
 *
 * <p>整个 Bean 由 {@code campus-market.expiry-job-enabled} 条件装配：属性为 false 时
 * Bean 根本不会创建，{@code @Scheduled} 自然不会注册，也就不存在定时任务主动去拿数据库连接。
 *
 * <p>这里刻意<b>不</b>使用「方法体开头 {@code if (!enabled) return}」的写法——那种写法下
 * 事务代理（或任何环绕通知）在 guard 之前就已经切入，测试环境里仍会看到调度线程建立连接。
 * 旧的 {@code OrderService.scheduledExpire()} 正是这个问题，已随本次改造一并移除，
 * 因此全应用只剩这一个调度入口，不存在双重调度。
 *
 * <p>本类自身不带事务：事务边界由 {@link OrderTransitionExecutor#sweepExpired()} 提供。
 */
@Component
@ConditionalOnProperty(name = "campus-market.expiry-job-enabled", havingValue = "true", matchIfMissing = true)
public class OrderExpiryJob {

    private final OrderTransitionExecutor transitions;

    public OrderExpiryJob(OrderTransitionExecutor transitions) {
        this.transitions = transitions;
    }

    @Scheduled(fixedDelay = 60_000)
    public void sweepExpiredOrders() {
        transitions.sweepExpired();
    }
}
