package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.service.OrderExpiryJob;
import com.lulu.campusmarketbackend.service.OrderTransitionExecutor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Method;
import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 订单超时清扫任务的条件装配测试（0.7A）。
 *
 * <p>旧实现把开关做在 {@code OrderService.scheduledExpire()} 的方法体开头
 * （{@code if (!enabled) return}）。那种写法下 {@code @Transactional} 代理在 guard 之前
 * 就已经切入，测试环境即便设了 {@code expiry-job-enabled=false}，调度线程仍会建立
 * 数据库连接——这一点在 0.5A/0.5B/0.5C/0.6A 的日志中反复出现。
 *
 * <p>现在改为整个 {@link OrderExpiryJob} Bean 由 {@code @ConditionalOnProperty} 控制：
 * 关闭时 Bean 不存在，{@code @Scheduled} 不注册，调度线程不会出现。
 *
 * <p>本类是普通单元测试（Surefire 执行），不需要 Docker。
 */
class OrderExpiryJobConfigurationTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(StubExecutorConfiguration.class)
            .withBean(OrderExpiryJob.class, () -> new OrderExpiryJob(mock(OrderTransitionExecutor.class)));

    @Test
    @DisplayName("1. expiry-job-enabled=false 时 OrderExpiryJob Bean 不存在")
    void jobBeanIsAbsentWhenDisabled() {
        new ApplicationContextRunner()
                .withUserConfiguration(StubExecutorConfiguration.class, JobConfiguration.class)
                .withPropertyValues("campus-market.expiry-job-enabled=false")
                .run(context -> assertThat(context)
                        .as("关闭时不得创建调度 Bean，否则 @Scheduled 仍会注册")
                        .hasNotFailed()
                        .doesNotHaveBean(OrderExpiryJob.class));
    }

    @Test
    @DisplayName("2. expiry-job-enabled=true 时 Bean 存在，且全应用只有一个调度入口")
    void jobBeanIsPresentWhenEnabled() {
        new ApplicationContextRunner()
                .withUserConfiguration(StubExecutorConfiguration.class, JobConfiguration.class)
                .withPropertyValues("campus-market.expiry-job-enabled=true")
                .run(context -> assertThat(context)
                        .hasNotFailed()
                        .hasSingleBean(OrderExpiryJob.class));
    }

    @Test
    @DisplayName("3. 属性缺省时按启用处理（生产默认行为）")
    void jobBeanDefaultsToEnabled() {
        new ApplicationContextRunner()
                .withUserConfiguration(StubExecutorConfiguration.class, JobConfiguration.class)
                .run(context -> assertThat(context).hasNotFailed().hasSingleBean(OrderExpiryJob.class));
    }

    @Test
    @DisplayName("4. OrderExpiryJob 内只有一个 @Scheduled 方法，且 OrderService 已无调度入口")
    void exactlyOneScheduledEntryPoint() {
        long scheduledInJob = Arrays.stream(OrderExpiryJob.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(org.springframework.scheduling.annotation.Scheduled.class))
                .count();
        assertThat(scheduledInJob).as("调度入口有且仅有一个").isEqualTo(1);

        long scheduledInOrderService = Arrays.stream(
                        com.lulu.campusmarketbackend.service.OrderService.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(org.springframework.scheduling.annotation.Scheduled.class))
                .count();
        assertThat(scheduledInOrderService)
                .as("旧的 OrderService 调度入口必须已移除，避免双重调度").isZero();

        Method entry = Arrays.stream(OrderExpiryJob.class.getDeclaredMethods())
                .filter(m -> m.isAnnotationPresent(org.springframework.scheduling.annotation.Scheduled.class))
                .findFirst().orElseThrow();
        assertThat(entry.isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class))
                .as("调度方法自身不应带事务，事务边界由 sweepExpired() 提供").isFalse();
    }

    @Configuration(proxyBeanMethods = false)
    static class StubExecutorConfiguration {
        @Bean
        OrderTransitionExecutor orderTransitionExecutor() { return mock(OrderTransitionExecutor.class); }
    }

    /** 让 @ConditionalOnProperty 真正参与求值，必须经由 @Bean 方法而非 withBean 直接注册。 */
    @Configuration(proxyBeanMethods = false)
    static class JobConfiguration {
        @Bean
        @org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(
                name = "campus-market.expiry-job-enabled", havingValue = "true", matchIfMissing = true)
        OrderExpiryJob orderExpiryJob(OrderTransitionExecutor transitions) { return new OrderExpiryJob(transitions); }
    }
}
