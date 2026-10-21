package com.lulu.campusmarketbackend.school;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.ReferenceMapper;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * 模块 6.1A：学校口径的唯一来源。
 *
 * <p>「PUBLIC」表示<b>当前学校</b>公开，不表示整个部署实例公开。学校永远由认证用户所在校区推导，
 * 客户端提交的任何 schoolId 都不会被采信（请求里出现即 400）。校区合法性以数据库 campuses 表为准，
 * 不再使用硬编码的校区名单——新学校通过学校数据包导入（docs/school-data.md）。
 * 新的输入只接受<b>在用</b>校区（campuses.active）；注册还要求学校可见（schools.active，且不是被隐藏的演示学校）。
 *
 * <p>读取侧的隔离写在 V10 重新定义的 {@code product_visible_to} 里（SQL 口径）；
 * 写入侧（发布、改价改校区、改资料、申请联系）经由这里校验，并由 V10 的触发器兜底。
 */
@Component
public class SchoolScope {
    private final ReferenceMapper references;
    private final DemoSchool demo;

    public SchoolScope(ReferenceMapper references, DemoSchool demo) {
        this.references = references;
        this.demo = demo;
    }

    /** 认证用户所属学校。用户不存在视为未认证。 */
    public String schoolOf(String uid) {
        UUID id;
        try {
            id = UUID.fromString(uid);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw ApiException.unauthorized("请先登录");
        }
        String school = references.selectUserSchool(id);
        if (school == null) throw ApiException.unauthorized("请先登录");
        return school;
    }

    /**
     * 注册：校区必须是<b>可见学校</b>的在用校区——学校 active、校区 active，且不是已隐藏的演示学校
     * （DEMO_SCHOOL_ENABLED=false 时的 'pilot'）。与 GET /v1/schools 列出的校区完全一致。
     */
    public String requireRegistrableCampus(Object raw) {
        String campus = normalize(raw);
        Map<String, Object> state = campus == null ? null : references.selectCampusState(campus);
        if (!listed(state)) throw ApiException.badRequest("校区无效");
        return campus;
    }

    /** 校区必须存在（不论是否在用）。用于楼栋列表：不存在的校区 400，停用 / 隐藏的校区由调用方返回空列表。 */
    public String requireExistingCampus(Object raw) {
        String campus = normalize(raw);
        if (campus == null || references.selectCampusState(campus) == null) throw ApiException.badRequest("校区无效");
        return campus;
    }

    /** 校区是否出现在公开的学校列表里（在用校区 + 在用且可见的学校）。 */
    public boolean isListedCampus(String campus) {
        return campus != null && listed(references.selectCampusState(campus));
    }

    /**
     * 校区必须是指定学校的<b>在用</b>校区（发布、修改商品、草稿、修改资料）。他校校区、停用校区与不存在的校区是同一个 400。
     * 演示学校被隐藏时它的校区仍然在用：演示学校的老用户照常发布。
     */
    public String requireCampusInSchool(Object raw, String school) {
        String campus = normalize(raw);
        Map<String, Object> state = campus == null ? null : references.selectCampusState(campus);
        if (state == null || !school.equals(state.get("school_id")) || !Boolean.TRUE.equals(state.get("campus_active"))) {
            throw ApiException.badRequest("校区无效");
        }
        return campus;
    }

    /** 列表筛选：校区存在且属于本校即可（停用校区下的旧商品仍然可以筛出来）。 */
    public String requireKnownCampusInSchool(Object raw, String school) {
        String campus = normalize(raw);
        String owner = campus == null ? null : references.selectCampusSchool(campus);
        if (owner == null || !owner.equals(school)) throw ApiException.badRequest("校区无效");
        return campus;
    }

    /**
     * 修改资料里的校区：与当前校区相同视为没有修改（演示学校被隐藏、或校区已停用时，老用户提交完整表单不受影响）；
     * 换校区则必须是本校的在用校区，且本校不是已隐藏的演示学校。
     */
    public String requireProfileCampus(Object raw, String uid) {
        String campus = normalize(raw);
        UUID id = UUID.fromString(uid);
        if (campus != null && campus.equals(references.selectUserCampus(id))) return campus;
        String school = schoolOf(uid);
        String result = requireCampusInSchool(raw, school);
        if (!demo.visible(school)) throw ApiException.badRequest("校区无效");
        return result;
    }

    private boolean listed(Map<String, Object> state) {
        return state != null && Boolean.TRUE.equals(state.get("campus_active")) && Boolean.TRUE.equals(state.get("school_active"))
                && demo.visible(String.valueOf(state.get("school_id")));
    }

    private static String normalize(Object raw) {
        String campus = raw == null ? "" : String.valueOf(raw).trim();
        return campus.isEmpty() || campus.length() > 64 ? null : campus;
    }

    /** 请求参数里出现学校字段一律拒绝：学校只由认证身份决定。 */
    public static void rejectSchoolOverride(java.util.Map<String, ?> query) {
        for (String key : query.keySet()) {
            String k = key.toLowerCase(java.util.Locale.ROOT);
            if (k.equals("schoolid") || k.equals("school") || k.equals("school_id")) {
                throw ApiException.badRequest("不支持的字段：" + key);
            }
        }
    }
}
