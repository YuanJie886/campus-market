package com.lulu.campusmarketbackend.governance;

import com.lulu.campusmarketbackend.api.ApiException;

import java.util.Set;
import java.util.UUID;

/** 治理接口共用的输入校验：机器码必须在允许集合里；记录 id 格式无效与不存在同为 404。 */
final class GovernanceInput {

    private GovernanceInput() {
    }

    static String code(Object raw, Set<String> allowed, String label) {
        String value = raw == null ? "" : String.valueOf(raw);
        if (!allowed.contains(value)) throw ApiException.badRequest(label + "无效");
        return value;
    }

    static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.notFound("记录不存在");
        }
    }
}
