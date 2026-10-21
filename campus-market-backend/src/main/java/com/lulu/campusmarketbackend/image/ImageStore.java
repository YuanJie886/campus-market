package com.lulu.campusmarketbackend.image;

import java.util.Optional;
import java.util.UUID;

/**
 * 图片文件本体的存放位置。阶段 4 先提供本地卷实现（单机部署 / 受控试运行）；接入对象存储时只需要新增实现，
 * 登记信息、签名地址与权限判断都不变。
 */
public interface ImageStore {
    void put(UUID id, byte[] jpeg);

    Optional<byte[]> get(UUID id);

    void delete(UUID id);
}
