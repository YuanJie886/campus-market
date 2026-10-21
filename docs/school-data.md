# 学校数据：学校数据包与接入新学校

本文说明学校、校区、楼栋这三级参考数据如何进入系统，以及以后**不改代码**接入一所新学校的完整步骤。
实现：`campus-market-backend/src/main/java/com/lulu/campusmarketbackend/school/`；迁移：`V22__school_data_packs.sql`；
工具：`campus-market-backend/scripts/school-pack-from-csv.mjs`；模板：`docs/school-data/`。

---

## 1. 概览

- **学校数据包**：每所学校一个 JSON 文件 `<学校 id>.json`，包含学校名称、校区和各校区的楼栋（园区、楼名、可选坐标）。
- **启用**：环境变量 `SCHOOL_PACKS` 列出要导入的学校 id（逗号分隔），例如 `SCHOOL_PACKS=aust`。默认为空，不导入任何数据包。
- **文件位置**：先找 `SCHOOL_PACKS_DIR/<id>.json`（运维挂载的目录，可以覆盖内置版本），再找应用内置的
  `src/main/resources/schools/<id>.json`。两处都没有则启动失败。
- **导入时机**：每次后端启动、开始接请求之前。数据包没变（SHA-256 校验和与上次导入相同）就跳过。
- **演示学校**：V1 预置的 `pilot`（东/西/南/北校区）和 V3/V4 的虚构楼栋**不是**数据包，不受导入器管理。
  是否对新用户可见由 `DEMO_SCHOOL_ENABLED` 控制，**生产环境必须设为 `false`**（见第 6 节）。
- **客户端**：注册页、资料页从 `GET /v1/schools` 读取学校与校区，不再写死校区名（见第 7 节）。

当前内置数据包：

| 文件 | 学校 | 校区 | 楼栋 |
| --- | --- | --- | --- |
| `schools/aust.json` | 安徽理工大学（安理工） | `aust-huainan` 淮南校区（1）、`aust-hefei` 合肥校区（2） | **暂无**：楼栋名称与坐标尚未取得，待学校核实后补充；不得自行编造 |

---

## 2. 数据包格式

```json
{
  "id": "aust",
  "name": "安徽理工大学",
  "shortName": "安理工",
  "coordinateSystem": "GCJ-02",
  "notes": "数据来源与核实情况",
  "campuses": [
    {
      "id": "aust-huainan",
      "name": "淮南校区",
      "sortOrder": 1,
      "buildings": [
        { "id": "aust-hn-xxx", "zone": "某园区", "name": "某号楼", "latitude": 32.6, "longitude": 116.9, "sortOrder": 1 }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 学校 id，必须与文件名一致。`pilot` 保留给演示学校，不能使用 |
| `name` | 是 | 学校全称 |
| `shortName` | 否 | 简称 |
| `coordinateSystem` | 是 | `GCJ-02` / `WGS-84` / `BD-09` 之一，整所学校只有这一个值 |
| `active` | 否 | 默认 `true`；`false` 表示整所学校不再对新用户开放（见第 5 节） |
| `sortOrder` | 否 | 学校在列表中的顺序，默认 0 |
| `notes` | 否 | 给运维看的说明（数据来源、核实情况），不对外展示，≤ 2000 字 |
| `campuses[].id` / `name` / `sortOrder` | id、name 必填 | 校区；`sortOrder` 默认 0 |
| `campuses[].buildings` | 是 | 楼栋数组；还没有楼栋数据时写 `[]` |
| `buildings[].id` / `zone` / `name` | 是 | 楼栋 id、园区（楼栋与校区之间的分组）、楼栋名 |
| `buildings[].latitude` / `longitude` | 否 | 楼栋公共中心点，**两个都填或都不填** |
| `buildings[].sortOrder` | 否 | 园区内顺序，默认 0 |

校验规则（后端 `SchoolPackValidator` 与 Node 工具一致；任何一条不满足，后端**启动失败**并在日志里写明文件与字段路径，例如
`学校数据包 /data/schools/xx.json 无效：campuses[0].buildings[3].latitude：纬度 60.5 不在中国范围内（纬度 3～54）`）：

1. 学校、校区、楼栋 id 匹配 `^[a-z0-9][a-z0-9-]{1,62}$`（小写字母、数字、连字符，2～63 个字符）。建议校区 id 以学校 id 开头，楼栋 id 以校区缩写开头，例如 `aust-hn-…`。
2. 校区 id、楼栋 id 在数据包内唯一，在同时启用的所有数据包之间也唯一；并且不能与数据库里**其他学校**已有的校区 / 楼栋 id 冲突。
3. 名称（学校名、简称、校区名、园区、楼栋名）去掉首尾空白后非空，且不超过 40 个字符。同一学校内校区名不重复，同一校区内楼栋名不重复。
4. 经纬度要么都填、要么都不填；纬度 3～54、经度 73～136（中国范围）；必须写成数字，不要加引号。
5. `coordinateSystem` 只能是 `GCJ-02`、`WGS-84`、`BD-09`，楼栋不能单独声明坐标系。
6. 楼栋总数不超过 3000。
7. 不认识的字段一律拒绝（例如把 `latitude` 写成 `lat`），JSON 里重复的键也拒绝。
8. 已登记的楼栋不能换到另一个校区（需求订阅等数据以「楼栋 + 校区」引用它）。真的搬了位置，请给新位置一个新 id，旧 id 从数据包删掉即自动停用。

---

## 3. 接入一所新学校（或给安理工补楼栋）

### 第 1 步：准备学校信息

复制 `docs/school-data/school-meta-template.json`，填学校 id、全称、简称、坐标系和全部校区（id、名称、顺序）。
给已有学校补楼栋时，可以直接把现有数据包（例如 `src/main/resources/schools/aust.json`）当作学校信息文件。

### 第 2 步：填写楼栋 CSV

复制 `docs/school-data/buildings-template.csv`，**删除两行示例**（含「示例」字样的行会被工具拒绝），每栋楼一行：

| 列 | 说明 |
| --- | --- |
| `campus_id` | 必须是第 1 步里的某个校区 id |
| `zone` | 园区，例如「东苑」 |
| `building_id` | 楼栋 id，规则同上，全校唯一，一经使用不要再改 |
| `building_name` | 楼栋名，例如「3号楼」；含逗号时整格用双引号包起来 |
| `latitude` / `longitude` | 楼栋公共中心点；暂时没有可以都留空 |
| `sort_order` | 非负整数，可留空（视为 0） |

文件必须是 **UTF-8**（Excel 请选「CSV UTF-8」），第一行是表头。

**坐标怎么取**：用 [高德坐标拾取器](https://lbs.amap.com/tools/picker) 在地图上点楼栋的公共中心点（主入口附近即可，
不要取房间、楼层或任何人的位置），它给出的是 **GCJ-02** 坐标，学校信息里写 `"coordinateSystem": "GCJ-02"`。
**同一所学校只用一种坐标系**：不要把高德（GCJ-02）、GPS 设备（WGS-84）、百度（BD-09）取的点混在一起——
同一份地图上会出现几百米的偏移。确实需要换坐标系时，整所学校的坐标一起重取，一次性替换数据包。

### 第 3 步：转换

```bash
cd campus-market-backend
node scripts/school-pack-from-csv.mjs --meta school-meta.json --csv buildings.csv --out src/main/resources/schools/<学校id>.json
```

有问题时逐条打印（带 CSV 行号），不会生成文件，例如：

```
buildings.csv 第 7 行 latitude：纬度 60.5 不在中国范围内（纬度 3～54）
buildings.csv 第 9 行：campus_id 'aust-hn' 不在学校信息的 campuses 里（可选：aust-huainan、aust-hefei）
```

没有 Node 环境也可以手写 JSON，按第 2 节的格式即可；第 4 步的校验仍然必须做。

### 第 4 步：校验

```bash
node scripts/school-pack-from-csv.mjs --validate src/main/resources/schools/*.json
./mvnw -q test -Dtest='SchoolPack*Test'   # 后端校验器检查仓库里的每一个数据包
```

与数据库现有数据的冲突（id 已被其他学校占用等）只能在导入时发现：先在预发布环境启动一次。

### 第 5 步：放置文件

二选一：

- **随应用发布**：提交到 `campus-market-backend/src/main/resources/schools/<id>.json`，重新构建镜像；
- **运维挂载**：把文件放进一个目录挂载到容器，设置 `SCHOOL_PACKS_DIR=<目录>`。同名文件优先于内置版本，
  适合不重新构建就更新楼栋。

### 第 6 步：启用并重启

`SCHOOL_PACKS` 加上这所学校的 id（例如 `SCHOOL_PACKS=aust,newschool`），重启后端。日志里会出现：

```
school pack newschool imported from ...: {school=inserted, campuses={inserted=2, ...}, buildings={inserted=120, ...}}
```

### 第 7 步：核对

- `GET /v1/schools` 能看到新学校与校区，`hasBuildings` 符合预期；
- `GET /v1/buildings?campus=<校区id>` 返回楼栋；
- `SELECT school_id, checksum, imported_at, summary FROM school_pack_imports ORDER BY id DESC;` 有一条新的导入记录。

---

## 4. 启动导入的行为

- 在所有组件创建完、Web 服务开始接请求之前执行；此时 Flyway 已经迁移完毕。
- 先把全部启用的数据包读出并校验，再在**一个事务**里导入，事务开始时取 PostgreSQL 事务级 advisory lock：
  多个实例同时启动时依次执行，后到的实例看到校验和相同就跳过。任何一个数据包出错，整个导入回滚、应用启动失败。
- 学校、校区、楼栋按 id 新增或更新（学校：名称、简称、active、顺序；校区：名称、顺序，并置为在用；
  楼栋：园区、名称、坐标、顺序，并置为在用）。
- 每次实际导入在 `school_pack_imports` 记一行：学校 id、文件 SHA-256、时间、摘要（来源文件、坐标系、各类行数）。
  该表只增不改，禁止 UPDATE / DELETE / TRUNCATE。校验和与该校**最近一次**导入相同则什么也不做——
  所以手工改了库里的数据之后，同一份数据包不会把它改回来；要以数据包为准，改一下数据包（例如 `notes`）再重启即可。
- 从 `SCHOOL_PACKS` 去掉一所学校不会删除或停用它的数据，只是不再导入。

---

## 5. 删除与停用

**从不物理删除**：商品、用户资料（宿舍楼）、需求订阅都引用校区和楼栋。

- 数据包里删掉的**楼栋**、**校区**：导入时置为 `active=false`。删掉一个校区，它下面的楼栋也一并停用。
- 停用的楼栋：不出现在楼栋列表，不能被新选为宿舍楼 / 取货楼栋 / 订阅锚点；已经引用它的商品和资料照常显示楼名。
- 停用的校区：不出现在 `GET /v1/schools`，楼栋列表返回 `[]`，不能用于注册、发布、改资料、草稿、显式选择的需求订阅范围（400「校区无效」）；
  已经在这个校区的用户照常使用，提交资料时带上原校区不算修改。
- 停用的楼栋名可以被新楼栋沿用（V22 把「同校区楼栋名唯一」改成了「同校区**在用**楼栋名唯一」）。
- 整所学校停用：数据包里写 `"active": false` 并重启。学校不再出现在列表里，不能再注册；已有用户不受影响。
- 重新启用：把楼栋 / 校区加回数据包（同一个 id），或去掉 `"active": false`，重启即可。

---

## 6. 演示学校与 `DEMO_SCHOOL_ENABLED`

| | `true`（默认，开发 / 测试 / 演示） | `false`（**生产**） |
| --- | --- | --- |
| `GET /v1/schools` | 列出「试点学校（请部署时配置）」与东/西/南/北校区 | 不列出 |
| 注册到演示校区 | 可以 | 400「校区无效」 |
| 把资料改到演示校区 / 演示学校用户换校区 | 可以（本校内） | 400「校区无效」 |
| `GET /v1/buildings?campus=东校区` | 虚构楼栋 | `[]` |
| 已属于演示学校的老用户 | — | 照常登录、浏览、发布（数据不删除、不迁移） |

生产环境示例：`SCHOOL_PACKS=aust`、`DEMO_SCHOOL_ENABLED=false`。演示数据与真实学校之间的商品、资料、需求严格按学校隔离，
互相不可见，跨校的校区输入一律 400。

---

## 7. 接口

### `GET /v1/schools`（无需登录，普通信封）

```json
{"code":0,"message":"ok","data":[
  {"id":"aust","name":"安徽理工大学","shortName":"安理工","campuses":[
    {"id":"aust-huainan","name":"淮南校区","hasBuildings":false},
    {"id":"aust-hefei","name":"合肥校区","hasBuildings":false}]}
]}
```

- 只含在用且可见的学校、在用的校区；学校与校区都按 `sortOrder` → 名称（Unicode 码点序）→ id 排序。
- `shortName` 可能为 `null`。
- `hasBuildings`：该校区至少有一栋在用楼栋。为 `false` 时客户端隐藏楼栋选择与「只看本楼」，不要显示空的地图。

### 校区输入

- 注册：`campus` 必须是 `GET /v1/schools` 里列出的某个校区，否则 400「校区无效」。学校由校区推导，客户端不提交学校。
- 发布 / 修改商品、草稿与批量发布、修改资料、需求订阅显式选择的校区：必须是**本人所在学校**的在用校区，否则 400
  （需求订阅的跨校仍是原来的「校区不属于你所在的学校」）。
- 商品列表的 `campus` 筛选：本校校区即可（包括已停用的校区，便于查到老商品）。
- `GET /v1/buildings?campus=`：不存在的校区 400；停用校区、停用学校或已隐藏的演示学校的校区返回 `[]`。

---

## 8. 坐标系说明

- **GCJ-02**：高德、腾讯地图、微信小程序 `map` 组件使用的坐标系。国内地图展示首选。
- **WGS-84**：GPS 原始坐标。直接画在国内地图上会偏几百米。
- **BD-09**：百度地图坐标。

后端只保存与返回数据包里的原始坐标，不做转换；同一学校只有一种坐标系，所以「最近排序」的距离估算（同一坐标系内的近似直线距离）
不受影响。客户端在地图上展示时按 `coordinateSystem` 选择地图或做转换。

---

## 9. 测试

| 内容 | 位置 |
| --- | --- |
| 校验器逐条规则、加载顺序 | `campus-market-backend/src/test/java/.../school/SchoolPackValidatorTest.java` |
| 仓库里每个数据包都合法、安理工内容 | `.../school/SchoolPackFilesTest.java` |
| 启动导入、校验和跳过、变更与停用、非法数据包启动失败、多数据包、`GET /v1/schools`、安理工注册、跨校隔离、并发导入 | `.../school/SchoolPackImportIT.java` |
| `DEMO_SCHOOL_ENABLED=false` | `.../school/DemoSchoolHiddenIT.java` |
| CSV 工具 | `node --test campus-market-backend/scripts/school-pack-from-csv.test.mjs` |
