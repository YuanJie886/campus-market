package com.lulu.campusmarketbackend.school;

/** 数据包不合法或无法导入。启动时抛出即启动失败；消息里写明文件与字段，运维照着改即可。 */
public class SchoolPackException extends IllegalStateException {
    public SchoolPackException(String message) {
        super(message);
    }

    public SchoolPackException(String message, Throwable cause) {
        super(message, cause);
    }

    static SchoolPackException at(String source, String field, String problem) {
        return new SchoolPackException("学校数据包 " + source + " 无效：" + (field == null || field.isEmpty() ? "" : field + "：") + problem);
    }
}
