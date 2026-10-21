package com.lulu.campusmarketbackend.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.OffsetDateTime;
import java.util.UUID;

@Data
@TableName("users")
public class UserEntity {
    @TableId private UUID id;
    private String account;
    private String passwordHash;
    private String nickname;
    private String avatar;
    private String campus;
    /** 宿舍楼。可空，由用户自己填，系统绝不推断。 */
    private String dormBuildingId;
    private String contact;
    private OffsetDateTime createdAt;
}
