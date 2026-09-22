package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.SessionEntity;
import org.apache.ibatis.annotations.*;

import java.util.UUID;

@Mapper
public interface SessionMapper extends BaseMapper<SessionEntity> {
    @Select("SELECT count(*) FROM sessions WHERE id=#{sessionId} AND user_id=#{userId} AND expires_at>now()") int countValid(@Param("sessionId") UUID sessionId, @Param("userId") UUID userId);
    @Update("UPDATE sessions SET refresh_hash=#{hash} WHERE id=#{id} AND refresh_hash=#{oldHash} AND expires_at>now()") int rotate(@Param("id") UUID id, @Param("oldHash") String oldHash, @Param("hash") String hash);
    @Delete("DELETE FROM sessions WHERE id=#{id} AND refresh_hash=#{hash}") int deleteByHash(@Param("id") UUID id, @Param("hash") String hash);
}
