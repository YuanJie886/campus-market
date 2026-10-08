package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.UserEntity;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;
import java.util.UUID;

@Mapper
public interface UserMapper extends BaseMapper<UserEntity> {
    @Select("SELECT * FROM users WHERE id=#{id}") Map<String, Object> selectRowById(@Param("id") UUID id);
    @Select("SELECT * FROM users WHERE account=#{account}") Map<String, Object> selectRowByAccount(@Param("account") String account);
    /**
     * 按用户串行化的临界区（下单、订阅、批量发布）。用 FOR NO KEY UPDATE：同样彼此互斥，
     * 但不阻塞其他事务里指向这个用户的外键检查（FOR KEY SHARE）——否则「下单锁住买家」与
     * 「移除成员时写一条以他为对象的审计」会互相等待而死锁（CircleConcurrencyIT 场景 1、6）。
     */
    @Select("SELECT id FROM users WHERE id=#{id} FOR NO KEY UPDATE") Map<String, Object> lockById(@Param("id") UUID id);
    /** 模块 7：限制检查时的共享锁，与新建限制时的 FOR NO KEY UPDATE 互斥 */
    @Select("SELECT id FROM users WHERE id=#{id} FOR SHARE") Map<String, Object> lockShare(@Param("id") UUID id);
    @Select("SELECT campus FROM users WHERE id=#{id}") String selectCampus(@Param("id") UUID id);
}
