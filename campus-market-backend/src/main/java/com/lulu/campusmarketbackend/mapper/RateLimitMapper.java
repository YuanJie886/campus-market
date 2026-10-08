package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Delete;

import java.util.Map;

@Mapper
public interface RateLimitMapper {

    /**
     * 原子递增固定窗口计数，并返回递增后的计数与窗口结束时间。
     *
     * <p>窗口起点由<b>数据库</b>用 {@code to_timestamp(floor(extract(epoch from now())/w)*w)}
     * 对齐计算，多个实例即使时钟略有差异也会落在同一个窗口行上。
     *
     * <p>整个「插入或递增」是单条 {@code INSERT ... ON CONFLICT DO UPDATE}，
     * 不存在「先 SELECT 再 UPDATE」的检查-使用竞态，也不靠捕获唯一约束异常兜底。
     * {@code RETURNING} 让递增与读取在同一次往返内完成。
     */
    @Select("""
            INSERT INTO rate_limit_counters(scope, subject_hash, window_start, request_count, expires_at)
            VALUES (
              #{scope},
              #{subjectHash},
              to_timestamp(floor(extract(epoch from now()) / #{windowSeconds}) * #{windowSeconds}),
              1,
              to_timestamp(floor(extract(epoch from now()) / #{windowSeconds}) * #{windowSeconds})
                + (#{windowSeconds} * interval '1 second')
            )
            ON CONFLICT (scope, subject_hash, window_start)
            DO UPDATE SET request_count = rate_limit_counters.request_count + 1
            RETURNING request_count AS count, expires_at AS window_end
            """)
    Map<String, Object> incrementAndGet(@Param("scope") String scope,
                                        @Param("subjectHash") String subjectHash,
                                        @Param("windowSeconds") int windowSeconds);

    /** 删除已过期的计数行。返回删除行数，供测试与监控使用。 */
    @Delete("DELETE FROM rate_limit_counters WHERE expires_at <= now()")
    int deleteExpired();
}
