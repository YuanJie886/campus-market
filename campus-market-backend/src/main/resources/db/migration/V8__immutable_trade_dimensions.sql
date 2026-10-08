-- =============================================================================
-- V8 · 模块 5.7：冻结价格统计维度
--
-- V7 只冻结了成交价，统计维度（学校、分类、成色、形态、教材版本）却取自商品的「当前值」：
-- 卖家成交后改分类或校区，历史样本就会在统计里移动。V8 把这些维度与成交价一样在下单瞬间
-- 从服务端商品记录复制到订单上，之后不可修改；价格参考只读这些快照。
--
-- 旧订单（包括 V7 之后、V8 之前下的单）保持 NULL：不回填、不猜，快照不完整的订单不进入统计。
-- 本文件一旦被任何环境执行过，就禁止再修改；后续变更一律新增 V9。
-- =============================================================================

ALTER TABLE orders ADD COLUMN school_id_snapshot text REFERENCES schools(id);
ALTER TABLE orders ADD COLUMN category_snapshot text
    CHECK (category_snapshot IS NULL OR category_snapshot IN ('数码电子', '教材书籍', '生活用品', '服饰鞋包', '运动户外', '其他'));
ALTER TABLE orders ADD COLUMN condition_snapshot text
    CHECK (condition_snapshot IS NULL OR condition_snapshot IN ('全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'));
ALTER TABLE orders ADD COLUMN listing_kind_snapshot text
    CHECK (listing_kind_snapshot IS NULL OR listing_kind_snapshot IN ('SINGLE', 'BUNDLE'));
ALTER TABLE orders ADD COLUMN textbook_edition_id_snapshot text;

-- 四个基本维度要么同时存在、要么同时为空；有维度就必须有成交价快照
ALTER TABLE orders ADD CONSTRAINT orders_trade_dimensions_complete CHECK (
    ((school_id_snapshot IS NULL) = (category_snapshot IS NULL))
    AND ((school_id_snapshot IS NULL) = (condition_snapshot IS NULL))
    AND ((school_id_snapshot IS NULL) = (listing_kind_snapshot IS NULL))
    AND (school_id_snapshot IS NULL OR price_snapshot IS NOT NULL)
);
-- 教材版本只可能出现在单件教材书籍订单上，并且必须是同一所学校目录里的版本
ALTER TABLE orders ADD CONSTRAINT orders_textbook_snapshot_scope CHECK (
    textbook_edition_id_snapshot IS NULL
    OR (category_snapshot = '教材书籍' AND listing_kind_snapshot = 'SINGLE')
);
ALTER TABLE orders ADD CONSTRAINT orders_textbook_snapshot_school
    FOREIGN KEY (textbook_edition_id_snapshot, school_id_snapshot) REFERENCES textbook_editions(id, school_id);

-- 写入后不可修改：与 V7 的 orders_price_snapshot_guard 同一语义（给旧订单补写也算修改）
CREATE FUNCTION orders_trade_dimensions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.school_id_snapshot IS DISTINCT FROM OLD.school_id_snapshot
       OR NEW.category_snapshot IS DISTINCT FROM OLD.category_snapshot
       OR NEW.condition_snapshot IS DISTINCT FROM OLD.condition_snapshot
       OR NEW.listing_kind_snapshot IS DISTINCT FROM OLD.listing_kind_snapshot
       OR NEW.textbook_edition_id_snapshot IS DISTINCT FROM OLD.textbook_edition_id_snapshot THEN
        RAISE EXCEPTION '成交维度快照只在下单时写入，之后不可修改或补写' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER orders_trade_dimensions_guard
    BEFORE UPDATE OF school_id_snapshot, category_snapshot, condition_snapshot, listing_kind_snapshot, textbook_edition_id_snapshot
    ON orders FOR EACH ROW EXECUTE FUNCTION orders_trade_dimensions_guard();

-- 价格参考现在只读订单自身：一个覆盖索引即可完成「本校 + 分类（+ 成色）」的聚合，不再连接商品与校区。
-- 计划证据见 SupplyPerformanceIT。V7 为旧口径（按商品当前校区 / 分类）建的两个部分索引不再有查询使用，
-- 保留只会增加每次下单与改商品的写放大，因此在这里删除（不修改 V7 本身）。
CREATE INDEX orders_trade_guidance ON orders(school_id_snapshot, category_snapshot, condition_snapshot)
    INCLUDE (price_snapshot, updated_at, textbook_edition_id_snapshot)
    WHERE status = 'COMPLETED' AND price_snapshot IS NOT NULL AND listing_kind_snapshot = 'SINGLE';
DROP INDEX orders_completed_price_snapshot;
DROP INDEX products_single_campus_category;
