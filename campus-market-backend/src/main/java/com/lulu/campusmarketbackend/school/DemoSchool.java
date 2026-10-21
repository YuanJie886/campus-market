package com.lulu.campusmarketbackend.school;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * V1 预置的演示学校 'pilot'（东 / 西 / 南 / 北校区与 V3/V4 的虚构楼栋）。
 *
 * <p>campus-market.schools.demo-school-enabled（DEMO_SCHOOL_ENABLED，默认 true）为 false 时：
 * 不出现在 GET /v1/schools，不能再注册到它的校区，也不能把资料改到它的校区；楼栋列表返回空。
 * 已经属于演示学校的用户照常登录、浏览、发布（数据不删除、不迁移）。生产环境应设为 false。
 */
@Component
public class DemoSchool {
    public static final String ID = "pilot";

    private final boolean enabled;

    public DemoSchool(@Value("${campus-market.schools.demo-school-enabled:true}") boolean enabled) {
        this.enabled = enabled;
    }

    public boolean enabled() {
        return enabled;
    }

    /** 学校是否对新用户可见（不考虑 schools.active）。 */
    public boolean visible(String schoolId) {
        return enabled || !ID.equals(schoolId);
    }
}
