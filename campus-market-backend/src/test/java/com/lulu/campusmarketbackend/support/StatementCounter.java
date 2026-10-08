package com.lulu.campusmarketbackend.support;

import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.plugin.Interceptor;
import org.apache.ibatis.plugin.Intercepts;
import org.apache.ibatis.plugin.Invocation;
import org.apache.ibatis.plugin.Signature;
import org.apache.ibatis.session.SqlSessionFactory;

import java.sql.Connection;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 精确统计 MyBatis 实际准备的 SQL 语句条数，用于检测 N+1。
 *
 * <p>此前用 pg_stat_database 的事务计数做近似，但那组计数由统计进程<b>异步</b>刷新，
 * 短时间内读到的增量常常是 0——测试因此永远通过，什么也没证明。
 * 这里改为在 StatementHandler.prepare 上计数：每条真正发往数据库的语句都会经过这里。
 */
@Intercepts(@Signature(type = StatementHandler.class, method = "prepare",
        args = {Connection.class, Integer.class}))
public final class StatementCounter implements Interceptor {

    private final AtomicLong count = new AtomicLong();

    /** 注册到 MyBatis 配置上。重复注册同一个工厂时只保留一个计数器。 */
    public static StatementCounter install(SqlSessionFactory sessions) {
        for (Interceptor existing : sessions.getConfiguration().getInterceptors()) {
            if (existing instanceof StatementCounter counter) return counter;
        }
        StatementCounter counter = new StatementCounter();
        sessions.getConfiguration().addInterceptor(counter);
        return counter;
    }

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        count.incrementAndGet();
        return invocation.proceed();
    }

    /** 执行一段代码，返回期间发出的语句条数。 */
    public long during(Runnable action) {
        long before = count.get();
        action.run();
        return count.get() - before;
    }
}
