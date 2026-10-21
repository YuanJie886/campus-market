-- =============================================================================
-- V5 · 可信面交闭环：结构化验货清单、面交档期握手、出发/已到同步、流程事件
--
-- 边界声明（与产品文案一致）：
--   * 平台不接资金。验货记录是双方当面检查过程的凭证，不是平台鉴定、质量保证或法律担保。
--   * 不收集房间号、床位号、实时位置、运动轨迹或设备信息。「出发 / 已到」是本人手动
--     声明的状态，由服务端记录时间，不是定位结果，也绝不自动完成交易。
--
-- 不可篡改由数据库触发器保证，而不只靠服务层：
--   * 已发布的验货模板条目不可修改或删除；新规则只能以新版本发布；
--   * 订单验货快照一经生成，卖家声明部分不可修改；买家最终提交后整份记录不可修改；
--   * 到达状态不可倒退；只有订单买卖双方能拥有到达记录。
--
-- 旧数据：本迁移不为任何既有商品补写声明，不为任何既有订单补写验货、档期或到达记录。
-- 「没有记录」就是没有记录，不伪造成「已验货」「已到达」。
--
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V6。
-- =============================================================================


-- ----------------------------------------------------------------------------
-- 0. 面交点启用状态
--
-- 档期提议只能选择启用中的面交点。停用而非删除：历史订单仍引用它们。
-- ----------------------------------------------------------------------------

ALTER TABLE meeting_points ADD COLUMN active boolean NOT NULL DEFAULT true;


-- ----------------------------------------------------------------------------
-- 1. 验货模板（按分类、带版本、发布即冻结）
-- ----------------------------------------------------------------------------

CREATE TABLE inspection_templates (
    id         text PRIMARY KEY,
    category   text NOT NULL,
    version    integer NOT NULL CHECK (version > 0),
    title      text NOT NULL CHECK (length(btrim(title)) > 0),
    active     boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (category, version)
);

-- 每个分类同时最多一个启用版本：发布页只会拿到唯一的「当前版本」
CREATE UNIQUE INDEX inspection_templates_one_active ON inspection_templates(category) WHERE active;

CREATE TABLE inspection_template_items (
    id          text PRIMARY KEY,
    template_id text NOT NULL REFERENCES inspection_templates(id),
    -- 稳定的机器码，业务判断只用它；label 只是展示文案
    code        text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    label       text NOT NULL CHECK (length(btrim(label)) > 0),
    description text NOT NULL DEFAULT '',
    required    boolean NOT NULL DEFAULT true,
    sort_order  integer NOT NULL CHECK (sort_order >= 0),
    UNIQUE (template_id, code)
);

-- 模板条目发布即冻结：任何修改或删除都会被拒绝。要调整规则就发布新版本。
CREATE FUNCTION inspection_template_items_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'inspection template items are immutable; publish a new template version instead'
        USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER inspection_template_items_no_update
    BEFORE UPDATE OR DELETE ON inspection_template_items
    FOR EACH ROW EXECUTE FUNCTION inspection_template_items_immutable();

-- 模板本身只允许切换 active（下线旧版本、启用新版本），其余字段与删除一律拒绝
CREATE FUNCTION inspection_templates_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inspection templates cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.id <> OLD.id OR NEW.category <> OLD.category OR NEW.version <> OLD.version
       OR NEW.title <> OLD.title OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'only the active flag of an inspection template may change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER inspection_templates_guard
    BEFORE UPDATE OR DELETE ON inspection_templates
    FOR EACH ROW EXECUTE FUNCTION inspection_templates_guard();


-- ----------------------------------------------------------------------------
-- 2. 商品发布声明（卖家对每个条目的「当前」声明，可随商品编辑更新）
-- ----------------------------------------------------------------------------

CREATE TABLE product_inspection_disclosures (
    product_id         uuid NOT NULL REFERENCES products(id),
    template_id        text NOT NULL,
    item_code          text NOT NULL,
    declared_condition text NOT NULL CHECK (declared_condition IN ('NORMAL','DEFECT','NOT_TESTED','NOT_APPLICABLE')),
    -- 简短说明：限长，且不允许尖括号，杜绝把 HTML 塞进卖家声明
    note               text NOT NULL DEFAULT '' CHECK (length(note) <= 200 AND note !~ '[<>]'),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, item_code),
    -- 条目必须真实属于该模板版本
    FOREIGN KEY (template_id, item_code) REFERENCES inspection_template_items(template_id, code)
);


-- ----------------------------------------------------------------------------
-- 3. 订单验货快照（下单时复制，之后与商品当前声明完全脱钩）
-- ----------------------------------------------------------------------------

CREATE TABLE order_inspections (
    order_id                uuid PRIMARY KEY REFERENCES orders(id),
    -- NOT_PROVIDED：商品下单时没有结构化声明（旧商品或不支持的分类），此时无模板
    template_id             text REFERENCES inspection_templates(id),
    template_title_snapshot text,
    template_version        integer CHECK (template_version IS NULL OR template_version > 0),
    status                  text NOT NULL CHECK (status IN ('NOT_PROVIDED','PENDING','SUBMITTED','NEEDS_RESOLUTION')),
    has_mismatch            boolean NOT NULL DEFAULT false,
    submitted_at            timestamptz,
    submitted_by            uuid REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'NOT_PROVIDED') = (template_id IS NULL)),
    CHECK (template_id IS NULL OR (template_title_snapshot IS NOT NULL AND template_version IS NOT NULL)),
    -- 已提交 ⇔ 有提交人与提交时间
    CHECK ((status IN ('SUBMITTED','NEEDS_RESOLUTION')) = (submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
    -- 存在不一致 ⇔ 需要处理
    CHECK ((status = 'NEEDS_RESOLUTION') = has_mismatch),
    CHECK (submitted_at IS NULL OR submitted_at >= created_at)
);

CREATE TABLE order_inspection_items (
    order_id                  uuid NOT NULL REFERENCES order_inspections(order_id),
    item_code                 text NOT NULL,
    label_snapshot            text NOT NULL,
    description_snapshot      text NOT NULL,
    required_snapshot         boolean NOT NULL,
    sort_order                integer NOT NULL CHECK (sort_order >= 0),
    -- 卖家下单时的声明。可选条目卖家可以不声明，此时为 NULL（界面显示「未声明」）
    seller_condition_snapshot text CHECK (seller_condition_snapshot IN ('NORMAL','DEFECT','NOT_TESTED','NOT_APPLICABLE')),
    seller_note_snapshot      text NOT NULL DEFAULT '',
    -- 买家现场结果。草稿阶段可暂存，最终提交后冻结
    buyer_result              text CHECK (buyer_result IN ('MATCH','MISMATCH','NOT_CHECKABLE')),
    buyer_note                text NOT NULL DEFAULT '' CHECK (length(buyer_note) <= 200 AND buyer_note !~ '[<>]'),
    -- 由服务端在最终提交时写入
    checked_at                timestamptz,
    PRIMARY KEY (order_id, item_code),
    CHECK (checked_at IS NULL OR buyer_result IS NOT NULL)
);

-- 快照冻结：卖家声明部分任何时候都不可改；买家最终提交后整条不可改；条目不可删除
CREATE FUNCTION order_inspection_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'order inspection items cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.order_id <> OLD.order_id OR NEW.item_code <> OLD.item_code
       OR NEW.label_snapshot <> OLD.label_snapshot OR NEW.description_snapshot <> OLD.description_snapshot
       OR NEW.required_snapshot <> OLD.required_snapshot OR NEW.sort_order <> OLD.sort_order
       OR NEW.seller_condition_snapshot IS DISTINCT FROM OLD.seller_condition_snapshot
       OR NEW.seller_note_snapshot <> OLD.seller_note_snapshot THEN
        RAISE EXCEPTION 'order inspection snapshot is immutable' USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO parent_status FROM order_inspections WHERE order_id = OLD.order_id;
    IF parent_status IN ('SUBMITTED','NEEDS_RESOLUTION') THEN
        RAISE EXCEPTION 'submitted inspection is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_inspection_items_guard
    BEFORE UPDATE OR DELETE ON order_inspection_items
    FOR EACH ROW EXECUTE FUNCTION order_inspection_items_guard();

-- 验货记录本身：快照字段不可改；进入终态（已提交 / 需处理 / 无声明）后不可再改；不可删除
CREATE FUNCTION order_inspections_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'order inspections cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.order_id <> OLD.order_id
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.template_title_snapshot IS DISTINCT FROM OLD.template_title_snapshot
       OR NEW.template_version IS DISTINCT FROM OLD.template_version
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'order inspection snapshot is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('SUBMITTED','NEEDS_RESOLUTION','NOT_PROVIDED') THEN
        RAISE EXCEPTION 'final inspection record is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_inspections_guard
    BEFORE UPDATE OR DELETE ON order_inspections
    FOR EACH ROW EXECUTE FUNCTION order_inspections_guard();


-- ----------------------------------------------------------------------------
-- 4. 面交档期握手
--
-- 「当前协议」仍保存在 orders.meeting_point_id / meeting_at（沿用既有字段，
-- 过期清扫等既有逻辑无需改读取来源），新增 meeting_ends_at 与 meeting_revision：
--   revision 0 = 下单时买家提出、卖家接单即同意的原始预约；
--   revision N = 第 N 次被对方接受的改约提议。
-- 改约提议被接受之前，orders 上的当前协议保持不变——发起改约不会清空原档期。
-- ----------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN meeting_ends_at  timestamptz;
ALTER TABLE orders ADD COLUMN meeting_revision integer NOT NULL DEFAULT 0 CHECK (meeting_revision >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_meeting_window_check
    CHECK (meeting_ends_at IS NULL OR (meeting_ends_at > meeting_at AND meeting_ends_at <= meeting_at + interval '2 hours'));

CREATE TABLE order_meeting_proposals (
    id               uuid PRIMARY KEY,
    order_id         uuid NOT NULL REFERENCES orders(id),
    proposer_id      uuid NOT NULL REFERENCES users(id),
    meeting_point_id text NOT NULL REFERENCES meeting_points(id),
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    note             text NOT NULL DEFAULT '' CHECK (length(note) <= 100 AND note !~ '[<>]'),
    status           text NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN','SUPERSEDED')),
    -- 被接受时分配的协议版本号；未被接受过的提议没有版本号
    revision         integer CHECK (revision IS NULL OR revision > 0),
    created_at       timestamptz NOT NULL DEFAULT now(),
    responded_at     timestamptz,
    responded_by     uuid REFERENCES users(id),
    -- 时间段有上限，杜绝「整天都行」式的无意义档期
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '2 hours'),
    CHECK ((status = 'PENDING') = (responded_at IS NULL AND responded_by IS NULL)),
    CHECK (responded_at IS NULL OR responded_at >= created_at),
    -- 接受或拒绝必须由对方做出；撤回只能由发起方做出
    CHECK (status NOT IN ('ACCEPTED','REJECTED') OR responded_by <> proposer_id),
    CHECK (status <> 'WITHDRAWN' OR responded_by = proposer_id),
    -- 只有被接受过的提议（当前或已被替换）才有版本号
    CHECK ((status IN ('ACCEPTED','SUPERSEDED')) = (revision IS NOT NULL))
);

-- 同一订单最多一个待处理提议
CREATE UNIQUE INDEX order_meeting_proposals_one_pending ON order_meeting_proposals(order_id) WHERE status = 'PENDING';
-- 同一订单最多一个「当前生效」的已接受提议——并发接受也不可能产生两个当前档期
CREATE UNIQUE INDEX order_meeting_proposals_one_current ON order_meeting_proposals(order_id) WHERE status = 'ACCEPTED';
-- 协议版本号在订单内唯一
CREATE UNIQUE INDEX order_meeting_proposals_revision ON order_meeting_proposals(order_id, revision) WHERE revision IS NOT NULL;
-- 订单详情按时间列出提议历史
CREATE INDEX order_meeting_proposals_order_created ON order_meeting_proposals(order_id, created_at);


-- ----------------------------------------------------------------------------
-- 5. 出发 / 已到（本人手动声明，不是定位）
--
-- 刻意没有任何坐标、精度、路线或设备字段。
-- 每个协议版本各自一份：改约生效后新版本从 NOT_STARTED 重新开始，旧版本保留为历史。
-- 允许不经「出发」直接「已到」（例如同楼自提）；此时 departed_at 保持为空，不伪造出发时间。
-- ----------------------------------------------------------------------------

CREATE TABLE order_presence (
    order_id         uuid NOT NULL REFERENCES orders(id),
    user_id          uuid NOT NULL REFERENCES users(id),
    meeting_revision integer NOT NULL CHECK (meeting_revision >= 0),
    status           text NOT NULL CHECK (status IN ('NOT_STARTED','DEPARTED','ARRIVED')),
    departed_at      timestamptz,
    arrived_at       timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, user_id, meeting_revision),
    CHECK (status <> 'NOT_STARTED' OR (departed_at IS NULL AND arrived_at IS NULL)),
    CHECK (status <> 'DEPARTED'    OR (departed_at IS NOT NULL AND arrived_at IS NULL)),
    CHECK (status <> 'ARRIVED'     OR arrived_at IS NOT NULL),
    CHECK (departed_at IS NULL OR arrived_at IS NULL OR arrived_at >= departed_at)
);

-- 只有订单买卖双方能有到达记录；状态只能前进；已记录的时间不可改写
CREATE FUNCTION order_presence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE participant boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'presence history cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    SELECT (NEW.user_id = buyer_id OR NEW.user_id = seller_id) INTO participant FROM orders WHERE id = NEW.order_id;
    IF participant IS NOT TRUE THEN
        RAISE EXCEPTION 'only order participants may have presence' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.order_id <> OLD.order_id OR NEW.user_id <> OLD.user_id OR NEW.meeting_revision <> OLD.meeting_revision THEN
            RAISE EXCEPTION 'presence identity is immutable' USING ERRCODE = 'check_violation';
        END IF;
        IF (OLD.status = 'ARRIVED' AND NEW.status <> 'ARRIVED')
           OR (OLD.status = 'DEPARTED' AND NEW.status = 'NOT_STARTED') THEN
            RAISE EXCEPTION 'presence cannot move backwards' USING ERRCODE = 'check_violation';
        END IF;
        IF (OLD.departed_at IS NOT NULL AND NEW.departed_at IS DISTINCT FROM OLD.departed_at)
           OR (OLD.arrived_at IS NOT NULL AND NEW.arrived_at IS DISTINCT FROM OLD.arrived_at) THEN
            RAISE EXCEPTION 'recorded presence times are immutable' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER order_presence_guard
    BEFORE INSERT OR UPDATE OR DELETE ON order_presence
    FOR EACH ROW EXECUTE FUNCTION order_presence_guard();


-- ----------------------------------------------------------------------------
-- 6. 流程事件（时间线）
--
-- 订单状态变化仍写在 order_events（to_status 的语义是订单状态，不混用）。
-- 面交握手、到达、验货这些不改变订单状态的事件写在这里。
-- 只存稳定机器码与协议版本号，不存任何自由文本：备注、确认码、联系方式都不会进入时间线。
-- ----------------------------------------------------------------------------

CREATE TABLE order_flow_events (
    seq              bigserial PRIMARY KEY,
    order_id         uuid NOT NULL REFERENCES orders(id),
    actor_id         uuid REFERENCES users(id),
    event_code       text NOT NULL CHECK (event_code IN (
                         'MEETING_PROPOSED','MEETING_ACCEPTED','MEETING_REJECTED','MEETING_WITHDRAWN',
                         'PRESENCE_DEPARTED','PRESENCE_ARRIVED',
                         'INSPECTION_SUBMITTED','INSPECTION_MISMATCH')),
    meeting_revision integer CHECK (meeting_revision IS NULL OR meeting_revision >= 0),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_flow_events_order ON order_flow_events(order_id, created_at, seq);

-- order_events 自 V1 起没有 order_id 索引：订单详情的时间线要按订单取事件，
-- 万级订单下实测为对 order_events 的全表顺序扫描（见 TrustedFlowPerformanceIT）。
-- 这是本模块唯一一个为既有表新增的索引，有执行计划作为依据。
CREATE INDEX order_events_order_created ON order_events(order_id, created_at);


-- ----------------------------------------------------------------------------
-- 7. 验货模板种子（V1 版本）
--
-- 分类取自 MarketService.CATEGORIES 的真实常量。「其他」刻意不提供模板：
-- 品类太杂，一份通用清单只会变成走形式的勾选。无模板的分类允许无清单发布。
-- ----------------------------------------------------------------------------

INSERT INTO inspection_templates(id, category, version, title) VALUES
  ('tpl-digital-v1', '数码电子', 1, '数码电子验货清单'),
  ('tpl-books-v1',   '教材书籍', 1, '教材书籍验货清单'),
  ('tpl-daily-v1',   '生活用品', 1, '生活用品验货清单'),
  ('tpl-apparel-v1', '服饰鞋包', 1, '服饰鞋包验货清单'),
  ('tpl-sports-v1',  '运动户外', 1, '运动户外验货清单');

INSERT INTO inspection_template_items(id, template_id, code, label, description, required, sort_order) VALUES
  ('tpl-digital-v1:POWER_ON',        'tpl-digital-v1', 'POWER_ON',        '能正常开机',         '开机进入系统，无反复重启',               true,  1),
  ('tpl-digital-v1:SCREEN',          'tpl-digital-v1', 'SCREEN',          '屏幕显示正常',       '无碎裂、坏点、大面积色斑或触控失灵',     true,  2),
  ('tpl-digital-v1:BATTERY',         'tpl-digital-v1', 'BATTERY',         '电池状况与描述一致', '续航或电池健康度与卖家描述相符',         true,  3),
  ('tpl-digital-v1:PORTS_BUTTONS',   'tpl-digital-v1', 'PORTS_BUTTONS',   '按键与接口正常',     '实体按键、充电口、耳机口可用',           true,  4),
  ('tpl-digital-v1:CAMERA_AUDIO',    'tpl-digital-v1', 'CAMERA_AUDIO',    '摄像头与声音正常',   '拍照、扬声器、麦克风可用（无此功能可选不适用）', false, 5),
  ('tpl-digital-v1:ACCOUNT_UNBOUND', 'tpl-digital-v1', 'ACCOUNT_UNBOUND', '已退出账号或解除绑定', '无激活锁、云账号或设备绑定残留',       true,  6),
  ('tpl-digital-v1:ACCESSORIES',     'tpl-digital-v1', 'ACCESSORIES',     '配件与描述一致',     '充电器、数据线、包装等',                 false, 7),
  ('tpl-digital-v1:APPEARANCE',      'tpl-digital-v1', 'APPEARANCE',      '外观与描述一致',     '划痕、磕碰程度与描述相符',               true,  8),

  ('tpl-books-v1:EDITION',        'tpl-books-v1', 'EDITION',        '版本与描述一致',   '书名、版次、ISBN 相符',       true,  1),
  ('tpl-books-v1:PAGES_COMPLETE', 'tpl-books-v1', 'PAGES_COMPLETE', '无缺页撕页',       '',                            true,  2),
  ('tpl-books-v1:NOTES',          'tpl-books-v1', 'NOTES',          '笔记划线与描述一致', '笔记、划线、答案填写的程度', true,  3),
  ('tpl-books-v1:COVER',          'tpl-books-v1', 'COVER',          '封面书脊完好',     '',                            false, 4),
  ('tpl-books-v1:WATER_DAMAGE',   'tpl-books-v1', 'WATER_DAMAGE',   '无水渍霉斑',       '',                            true,  5),

  ('tpl-daily-v1:FUNCTION',       'tpl-daily-v1', 'FUNCTION',       '功能正常',         '主要功能可以使用',            true,  1),
  ('tpl-daily-v1:APPEARANCE',     'tpl-daily-v1', 'APPEARANCE',     '外观与描述一致',   '',                            true,  2),
  ('tpl-daily-v1:CLEAN',          'tpl-daily-v1', 'CLEAN',          '清洁无异味',       '',                            true,  3),
  ('tpl-daily-v1:PARTS_COMPLETE', 'tpl-daily-v1', 'PARTS_COMPLETE', '部件齐全',         '',                            true,  4),
  ('tpl-daily-v1:ELECTRICAL',     'tpl-daily-v1', 'ELECTRICAL',     '电器线材无破损',   '非电器可选不适用',            false, 5),

  ('tpl-apparel-v1:SIZE',     'tpl-apparel-v1', 'SIZE',     '尺码与描述一致',     '',                  true,  1),
  ('tpl-apparel-v1:STAINS',   'tpl-apparel-v1', 'STAINS',   '无明显污渍',         '',                  true,  2),
  ('tpl-apparel-v1:DAMAGE',   'tpl-apparel-v1', 'DAMAGE',   '无破损开线',         '',                  true,  3),
  ('tpl-apparel-v1:MATERIAL', 'tpl-apparel-v1', 'MATERIAL', '材质与描述一致',     '',                  false, 4),
  ('tpl-apparel-v1:WEAR',     'tpl-apparel-v1', 'WEAR',     '磨损程度与描述一致', '鞋底、包角、起球等', true,  5),

  ('tpl-sports-v1:STRUCTURE',      'tpl-sports-v1', 'STRUCTURE',      '结构无裂纹变形', '车架、拍框、器械主体', true,  1),
  ('tpl-sports-v1:FUNCTION',       'tpl-sports-v1', 'FUNCTION',       '功能正常',       '',                    true,  2),
  ('tpl-sports-v1:WEAR',           'tpl-sports-v1', 'WEAR',           '磨损与描述一致', '',                    true,  3),
  ('tpl-sports-v1:PARTS_COMPLETE', 'tpl-sports-v1', 'PARTS_COMPLETE', '配件齐全',       '',                    false, 4),
  ('tpl-sports-v1:SAFETY',         'tpl-sports-v1', 'SAFETY',         '安全部件完好',   '刹车、绑带、锁扣等',  true,  5);
