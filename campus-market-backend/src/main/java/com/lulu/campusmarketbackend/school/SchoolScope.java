package com.lulu.campusmarketbackend.school;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.ReferenceMapper;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 模块 6.1A：学校口径的唯一来源。
 *
 * <p>「PUBLIC」表示<b>当前学校</b>公开，不表示整个部署实例公开。学校永远由认证用户所在校区推导，
 * 客户端提交的任何 schoolId 都不会被采信（请求里出现即 400）。校区合法性以数据库 campuses 表为准，
 * 不再使用硬编码的校区名单——多校部署时新学校只需要在 campuses 里登记。
 *
 * <p>读取侧的隔离写在 V10 重新定义的 {@code product_visible_to / product_readable_by} 里（SQL 口径）；
 * 写入侧（发布、改价改校区、改资料、下单）经由这里校验，并由 V10 的触发器兜底。
 */
@Component
public class SchoolScope {
    private final ReferenceMapper references;

    public SchoolScope(ReferenceMapper references) {
        this.references = references;
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

    /** 校区必须真实存在（注册、楼栋参考数据）。 */
    public String requireCampus(Object raw) {
        String campus = raw == null ? "" : String.valueOf(raw).trim();
        if (campus.isEmpty() || campus.length() > 40 || references.selectCampusSchool(campus) == null) {
            throw ApiException.badRequest("校区无效");
        }
        return campus;
    }

    /** 校区必须属于指定学校（发布、修改商品、修改资料、列表筛选）。他校校区与不存在的校区是同一个 400。 */
    public String requireCampusInSchool(Object raw, String school) {
        String campus = raw == null ? "" : String.valueOf(raw).trim();
        String owner = campus.isEmpty() || campus.length() > 40 ? null : references.selectCampusSchool(campus);
        if (owner == null || !owner.equals(school)) throw ApiException.badRequest("校区无效");
        return campus;
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
