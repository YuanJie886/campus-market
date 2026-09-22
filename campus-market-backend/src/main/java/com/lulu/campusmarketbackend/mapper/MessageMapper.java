package com.lulu.campusmarketbackend.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.lulu.campusmarketbackend.entity.MessageEntity;
import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Mapper
public interface MessageMapper extends BaseMapper<MessageEntity> {
    @Select("SELECT * FROM messages WHERE conversation_id=#{conversationId} ORDER BY created_at,id") List<Map<String, Object>> selectRowsByConversation(@Param("conversationId") UUID conversationId);
    @Select("SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=#{uid} WHERE (c.buyer_id=#{uid} OR c.seller_id=#{uid}) AND m.sender_id<>#{uid} AND (r.read_at IS NULL OR m.created_at>r.read_at)") long countUnread(@Param("uid") UUID uid);
}
