package com.lulu.campusmarketbackend.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * 楼栋参考数据的只读访问。
 *
 * <p>楼栋是公共参考数据，不含任何住户信息——这里刻意没有「按楼栋查用户」的方法，
 * 免得日后有人顺手用它做出「本楼有多少人」这类会暴露居住分布的接口。
 */
@Mapper
public interface BuildingMapper {

    /**
     * 列出某校区的可选楼栋。zone 为空时返回该校区全部园区。
     *
     * <p>排序：园区 → 校方给的序号 → 楼栋名 → id。文本列显式使用 {@code COLLATE "C"}
     * （按 Unicode 码点比较）：默认排序规则取决于建库时的 locale，同一份数据在
     * zh_CN 与 en_US 的库里园区先后会不一样。码点序与前端 Mock 的比较方式一致，
     * 且与部署环境无关。最后用 id 收敛，保证任何情况下都有全序。
     */
    @Select("""
            <script>
            SELECT id, campus_id, zone, name, latitude, longitude, sort_order
            FROM buildings
            WHERE campus_id = #{campus} AND active
            <if test="zone != null and zone != ''">AND zone = #{zone}</if>
            ORDER BY zone COLLATE "C", sort_order, name COLLATE "C", id COLLATE "C"
            </script>
            """)
    List<Map<String, Object>> selectActiveByCampus(@Param("campus") String campus, @Param("zone") String zone);

    /** 按 id 读取楼栋，含已停用的——旧商品仍可能引用停用楼栋，展示时需要拿到名字。 */
    @Select("SELECT id, campus_id, zone, name, latitude, longitude, sort_order, active "
            + "FROM buildings WHERE id = #{id}")
    Map<String, Object> selectById(@Param("id") String id);

    /** 列出某校区的稳定面交点（含坐标）。 */
    @Select("SELECT id, campus_id, name, latitude, longitude FROM meeting_points "
            + "WHERE campus_id = #{campus} ORDER BY id")
    List<Map<String, Object>> selectMeetingPointsByCampus(@Param("campus") String campus);

    /** 全部楼栋（参考数据，几十行）。批量发布校验一次取回，逐条在内存里检查。 */
    @Select("SELECT id, campus_id, zone, name, latitude, longitude, sort_order, active FROM buildings ORDER BY id")
    List<Map<String, Object>> selectAllBuildings();
}
