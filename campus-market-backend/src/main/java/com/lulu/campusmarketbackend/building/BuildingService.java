package com.lulu.campusmarketbackend.building;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.mapper.BuildingMapper;
import com.lulu.campusmarketbackend.service.DomainMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * 楼栋参考数据的查询与校验。
 *
 * <p>楼栋与校区的一致性校验只在这里实现一次：用户资料和商品发布都要做同样的检查，
 * 分散实现迟早会有一处漏掉「楼栋必须属于该校区」，让 A 校区的商品挂到 B 校区的楼下。
 */
@Service
public class BuildingService {

    private final BuildingMapper buildings;
    private final DomainMapper mapper;

    public BuildingService(BuildingMapper buildings, DomainMapper mapper) {
        this.buildings = buildings;
        this.mapper = mapper;
    }

    /** 某校区的可选楼栋列表。公共数据，未登录也可读。 */
    public List<Map<String, Object>> list(String campus, String zone) {
        return buildings.selectActiveByCampus(campus, zone).stream().map(mapper::building).toList();
    }

    /** 原始行，供需要坐标的内部计算使用。 */
    public Map<String, Object> rowById(String buildingId) {
        return buildingId == null || buildingId.isBlank() ? null : buildings.selectById(buildingId);
    }

    /**
     * 校验一个楼栋可以被<b>新</b>关联到某校区的资料或商品上。
     *
     * <p>三种失败语义刻意区分开：
     * <ul>
     *   <li>楼栋不存在 → 404，和其他「资源不存在」一致；</li>
     *   <li>楼栋已停用 → 400，资源存在但不是合法输入，告诉用户换一个；</li>
     *   <li>楼栋不属于该校区 → 400，这是校区与楼栋的组合错误，不是楼栋本身不存在。
     *       不用 404 是为了不让调用方误以为楼栋 id 写错了。</li>
     * </ul>
     */
    public String requireSelectable(String buildingId, String campus) {
        Map<String, Object> row = buildings.selectById(buildingId);
        if (row == null) throw ApiException.notFound("楼栋不存在");
        if (!Boolean.TRUE.equals(row.get("active"))) throw ApiException.badRequest("该楼栋已停用，请选择其他楼栋");
        if (!campus.equals(DomainMapper.text(row.get("campus_id")))) {
            throw ApiException.badRequest("所选楼栋不属于该校区");
        }
        return DomainMapper.text(row.get("id"));
    }

    /** 某校区的稳定面交点（含坐标）。 */
    public List<Map<String, Object>> meetingPoints(String campus) {
        return buildings.selectMeetingPointsByCampus(campus).stream().map(mapper::meetingPoint).toList();
    }
}
