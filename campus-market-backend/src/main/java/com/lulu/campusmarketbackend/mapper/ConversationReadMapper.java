package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.ConversationReadEntity;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.UUID;

@Mapper
public interface ConversationReadMapper extends BaseMapper<ConversationReadEntity> {
    @Insert("INSERT INTO conversation_reads(conversation_id,user_id) VALUES(#{conversationId},#{userId}) ON CONFLICT(conversation_id,user_id) DO UPDATE SET read_at=now()") int markRead(@Param("conversationId") UUID conversationId, @Param("userId") UUID userId);
}
