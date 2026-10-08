-- =============================================================================
-- V3 · 楼栋集市：楼栋参考数据、宿舍楼/取货楼栋关联、面交点坐标
--
-- 背景：校园二手交易的真实痛点是「能不能楼下自提」。此前系统只有校区（campus）
-- 这一级粒度，同一校区内两端相隔一公里和同楼栋是同一种展示，用户无从判断。
-- V3 引入楼栋这一级，并给稳定面交点补上坐标，使「只看本楼」「最近排序」
-- 与「校园示意地图」有数据可依。
--
-- 类型选择：schools / campuses / meeting_points 的主键都是 text，
-- users.campus 与 products.campus 也是 text 外键。buildings 属于同一类参考数据，
-- 因此主键同样用 text，而不是另起 uuid 或 bigint——混用会让 JOIN 处处需要转换。
--
-- 隐私边界：
--   * 坐标是楼栋的<b>公共中心点</b>，不是房间、楼层、床位，更不是任何人的实时位置。
--   * 本迁移不推断、不填充任何用户的宿舍楼：dorm_building_id 一律留空，由用户自己填。
--   * 不新增房间号 / 楼层 / 床位字段，将来也不应新增。
--
-- 演示数据声明：下方种子楼栋与坐标均为<b>虚构的演示数据</b>，坐标落在一片
-- 不对应任何真实校园的矩形区域内。它们只用于示意地图与近似距离估算，
-- 不是真实校园导航数据，也未使用任何真实高校的宿舍信息。
-- 接入真实学校时应替换这批数据，见 docs/building-market.md。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V4。
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 1. buildings：楼栋参考数据
-- ----------------------------------------------------------------------------

CREATE TABLE buildings (
    id         text PRIMARY KEY,
    campus_id  text NOT NULL REFERENCES campuses(id),
    -- 园区，例如「沁园」。楼栋与校区之间的中间层，用于「本楼 → 同园区」的降级
    zone       text NOT NULL CHECK (length(btrim(zone)) > 0),
    -- 楼栋名，例如「3号楼」
    name       text NOT NULL CHECK (length(btrim(name)) > 0),
    -- 楼栋公共中心点。可空：允许先录入楼栋、后补坐标，缺坐标时降级为不做距离估算
    latitude   double precision CHECK (latitude  BETWEEN -90  AND 90),
    longitude  double precision CHECK (longitude BETWEEN -180 AND 180),
    -- 停用的楼栋用 active=false 保留，不物理删除：仍被旧商品与用户资料引用
    active     boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- 同一校区内楼栋名唯一；不同校区可以都有「3号楼」
    UNIQUE (campus_id, name)
);

-- 「按校区列出可选楼栋」是最高频的读路径
CREATE INDEX buildings_campus_active_sort ON buildings(campus_id, active, sort_order);
-- 「同园区降级」按 (campus, zone) 收敛候选楼栋
CREATE INDEX buildings_campus_zone ON buildings(campus_id, zone);


-- ----------------------------------------------------------------------------
-- 2. 关联字段
--
-- 两个字段都<b>可空</b>：旧用户没有填过宿舍楼，旧商品没有取货楼栋，
-- 迁移不替他们猜。NULL 表示「未指定」，不表示「未知但存在」。
-- ----------------------------------------------------------------------------

ALTER TABLE users    ADD COLUMN dorm_building_id text REFERENCES buildings(id);
ALTER TABLE products ADD COLUMN building_id      text REFERENCES buildings(id);

-- 「本楼商品」查询：楼栋 + 状态联合过滤
CREATE INDEX products_building_status ON products(building_id, status);
-- 按宿舍楼反查用户的场景很少，但外键列无索引会让楼栋停用时的引用检查退化为全表扫描
CREATE INDEX users_dorm_building ON users(dorm_building_id);


-- ----------------------------------------------------------------------------
-- 3. meeting_points 坐标
--
-- V1 建表时只有 id / campus_id / name。示意地图与「推荐面交点」需要坐标。
-- ----------------------------------------------------------------------------

ALTER TABLE meeting_points ADD COLUMN latitude  double precision CHECK (latitude  BETWEEN -90  AND 90);
ALTER TABLE meeting_points ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180);

-- meeting_points 目前只有 12 行，但「按校区列出面交点」是地图的固定入口
CREATE INDEX meeting_points_campus ON meeting_points(campus_id);


-- ----------------------------------------------------------------------------
-- 4. 演示种子数据
--
-- 四个演示校区 × 2 个园区 × 2～3 栋 = 20 栋。
-- id 采用「校区-拼音园区-序号」的稳定形式，重复执行迁移不会产生新 id
-- （V3 本身只会执行一次，这里不使用 ON CONFLICT 掩盖结构错误）。
--
-- 坐标：以 (31.0000, 121.0000) 为演示原点，按校区和园区做固定偏移。
-- 相邻楼栋约 60～150 米，园区之间约 300～500 米，校区之间约 2 公里——
-- 量级贴近真实校园，便于演示「同楼栋 / 约 N 分钟」，但地点本身是虚构的。
-- ----------------------------------------------------------------------------

INSERT INTO buildings(id, campus_id, zone, name, latitude, longitude, sort_order) VALUES
  -- 东校区：沁园（1～3 号楼）、松园（4～5 号楼）
  -- 楼号在校区内连续编号，园区只是分组——这与「同校区内楼栋名唯一」的约束一致，
  -- 也符合现实中宿舍楼的编号习惯（不会出现两个「1号楼」让人走错）。
  ('east-qinyuan-1',  '东校区', '沁园', '1号楼', 31.00000, 121.00000, 1),
  ('east-qinyuan-2',  '东校区', '沁园', '2号楼', 31.00090, 121.00000, 2),
  ('east-qinyuan-3',  '东校区', '沁园', '3号楼', 31.00180, 121.00000, 3),
  ('east-songyuan-4', '东校区', '松园', '4号楼', 31.00000, 121.00420, 4),
  ('east-songyuan-5', '东校区', '松园', '5号楼', 31.00090, 121.00420, 5),

  -- 西校区：竹园（1～2 号楼）、梅园（3～5 号楼）
  ('west-zhuyuan-1',  '西校区', '竹园', '1号楼', 31.00000, 120.97900, 1),
  ('west-zhuyuan-2',  '西校区', '竹园', '2号楼', 31.00090, 120.97900, 2),
  ('west-meiyuan-3',  '西校区', '梅园', '3号楼', 31.00000, 120.98320, 3),
  ('west-meiyuan-4',  '西校区', '梅园', '4号楼', 31.00090, 120.98320, 4),
  ('west-meiyuan-5',  '西校区', '梅园', '5号楼', 31.00180, 120.98320, 5),

  -- 南校区：兰园（1～2 号楼）、桂园（3～5 号楼）
  ('south-lanyuan-1', '南校区', '兰园', '1号楼', 30.98200, 121.00000, 1),
  ('south-lanyuan-2', '南校区', '兰园', '2号楼', 30.98290, 121.00000, 2),
  ('south-guiyuan-3', '南校区', '桂园', '3号楼', 30.98200, 121.00420, 3),
  ('south-guiyuan-4', '南校区', '桂园', '4号楼', 30.98290, 121.00420, 4),
  ('south-guiyuan-5', '南校区', '桂园', '5号楼', 30.98380, 121.00420, 5),

  -- 北校区：枫园（1～3 号楼）、杏园（4～5 号楼）
  ('north-fengyuan-1', '北校区', '枫园', '1号楼', 31.01800, 121.00000, 1),
  ('north-fengyuan-2', '北校区', '枫园', '2号楼', 31.01890, 121.00000, 2),
  ('north-fengyuan-3', '北校区', '枫园', '3号楼', 31.01980, 121.00000, 3),
  ('north-xingyuan-4', '北校区', '杏园', '4号楼', 31.01800, 121.00420, 4),
  ('north-xingyuan-5', '北校区', '杏园', '5号楼', 31.01890, 121.00420, 5);


-- 面交点坐标：放在各校区楼栋群的中间位置，让「推荐面交点」有区分度。
UPDATE meeting_points SET latitude = 31.00090, longitude = 121.00210 WHERE id = '东校区-library';
UPDATE meeting_points SET latitude = 31.00230, longitude = 121.00100 WHERE id = '东校区-canteen';
UPDATE meeting_points SET latitude = 30.99950, longitude = 121.00330 WHERE id = '东校区-express';

UPDATE meeting_points SET latitude = 31.00090, longitude = 120.98110 WHERE id = '西校区-library';
UPDATE meeting_points SET latitude = 31.00230, longitude = 120.98000 WHERE id = '西校区-canteen';
UPDATE meeting_points SET latitude = 30.99950, longitude = 120.98230 WHERE id = '西校区-express';

UPDATE meeting_points SET latitude = 30.98290, longitude = 121.00210 WHERE id = '南校区-library';
UPDATE meeting_points SET latitude = 30.98430, longitude = 121.00100 WHERE id = '南校区-canteen';
UPDATE meeting_points SET latitude = 30.98150, longitude = 121.00330 WHERE id = '南校区-express';

UPDATE meeting_points SET latitude = 31.01890, longitude = 121.00210 WHERE id = '北校区-library';
UPDATE meeting_points SET latitude = 31.02030, longitude = 121.00100 WHERE id = '北校区-canteen';
UPDATE meeting_points SET latitude = 31.01750, longitude = 121.00330 WHERE id = '北校区-express';
