-- 阶段 4：真实图片上传与文本内容安全。
--   1. uploaded_images：服务端重新编码后的图片（去掉 EXIF / 定位等元数据），文件本体在对象存储 / 本地卷里，这里只存登记信息；
--   2. 商品只能引用卖家本人（或该商品的协助人）上传、仍有效的图片（提交时检查，覆盖单件、打包、批量发布与后台编辑）；
--   3. content_safety_events：被拦截或需要人工复核的文本只记录原因与指纹，不保存原文。
-- 只新增，不修改 V1～V18。

CREATE TABLE uploaded_images (
    id             uuid PRIMARY KEY,
    owner_user_id  uuid NOT NULL REFERENCES users(id),
    school_id      text NOT NULL REFERENCES schools(id),
    sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size      integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    width          integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height         integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
    content_type   text NOT NULL CHECK (content_type = 'image/jpeg'),
    status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HIDDEN', 'DELETED')),
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    status_changed_at timestamptz
);
CREATE INDEX uploaded_images_owner ON uploaded_images (owner_user_id, created_at DESC);

CREATE FUNCTION uploaded_images_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'image records cannot be deleted; set status = DELETED' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.owner_user_id, NEW.school_id, NEW.sha256, NEW.byte_size, NEW.width, NEW.height, NEW.content_type, NEW.created_at)
       IS DISTINCT FROM (OLD.owner_user_id, OLD.school_id, OLD.sha256, OLD.byte_size, OLD.width, OLD.height, OLD.content_type, OLD.created_at) THEN
        RAISE EXCEPTION 'image records are immutable except status' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'DELETED' AND NEW.status <> 'DELETED' THEN
        RAISE EXCEPTION 'deleted images cannot come back' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER uploaded_images_guard BEFORE UPDATE OR DELETE ON uploaded_images
    FOR EACH ROW EXECUTE FUNCTION uploaded_images_guard();

-- 商品引用的 upload:<id> 必须是卖家或协助人本人上传、仍有效的图片。提交时检查（批量发布先插入商品、再写协助人）
CREATE FUNCTION products_uploaded_images_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref text; image uuid; cur products%ROWTYPE;
BEGIN
    -- 延迟到提交时检查：读取商品此刻的最终状态（同一事务里后写入的协助人也算）
    SELECT * INTO cur FROM products WHERE id = NEW.id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    FOR ref IN SELECT jsonb_array_elements_text(cur.images) LOOP
        IF ref LIKE 'upload:%' THEN
            BEGIN
                image := substring(ref FROM 8)::uuid;
            EXCEPTION WHEN invalid_text_representation THEN
                RAISE EXCEPTION 'invalid uploaded image reference' USING ERRCODE = 'check_violation';
            END;
            IF NOT EXISTS (SELECT 1 FROM uploaded_images i WHERE i.id = image AND i.status = 'ACTIVE'
                                                         AND i.owner_user_id IN (cur.seller_id, cur.assisted_by)) THEN
                RAISE EXCEPTION 'products may only use active images uploaded by the seller or the assistant' USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END LOOP;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER products_uploaded_images_check AFTER INSERT OR UPDATE OF images, seller_id, assisted_by ON products
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION products_uploaded_images_check();

CREATE TABLE content_safety_events (
    id            bigserial PRIMARY KEY,
    user_id       uuid NOT NULL REFERENCES users(id),
    scene         text NOT NULL CHECK (scene IN ('PRODUCT', 'COMMENT', 'MESSAGE', 'PROFILE', 'CIRCLE')),
    provider      text NOT NULL CHECK (provider IN ('KEYWORD', 'WECHAT')),
    verdict       text NOT NULL CHECK (verdict IN ('BLOCKED', 'REVIEW')),
    -- 命中的规则编号 / 微信返回的标签，不保存用户原文；指纹用于判断是否重复提交
    label         text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 64),
    text_sha256   text NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX content_safety_events_user ON content_safety_events (user_id, created_at DESC);
CREATE TRIGGER content_safety_events_append_only BEFORE UPDATE OR DELETE ON content_safety_events
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER content_safety_events_no_truncate BEFORE TRUNCATE ON content_safety_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_no_truncate();
