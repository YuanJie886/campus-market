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
    /** 模块 6：未读数只计能访问的会话（与会话列表同一条件），不因私密商品形成侧信道。 */
    @Select("SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN products p ON p.id=c.product_id "
            + "LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=#{uid} "
            + "WHERE (c.seller_id=#{uid} OR (c.buyer_id=#{uid} AND product_readable_by(p.id, p.visibility, p.seller_id, p.campus, p.moderation_hidden_at, #{uid}))) "
            + "AND m.sender_id<>#{uid} AND (r.read_at IS NULL OR m.created_at>r.read_at)")
    long countUnread(@Param("uid") UUID uid);
}
