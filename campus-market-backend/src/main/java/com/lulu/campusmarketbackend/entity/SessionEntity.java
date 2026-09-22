package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("sessions")
public class SessionEntity {
    @TableId private UUID id;
    private UUID userId;
    private String refreshHash;
    private OffsetDateTime expiresAt;
    private OffsetDateTime createdAt;
}
