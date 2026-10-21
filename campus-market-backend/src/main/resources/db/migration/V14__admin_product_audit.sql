-- 后台商品信息编辑留痕，治理隐藏/恢复继续使用已有案件与 moderation_actions。
CREATE TABLE admin_product_audit (
    id uuid PRIMARY KEY,
    school_id text NOT NULL REFERENCES schools(id),
    product_id uuid NOT NULL REFERENCES products(id),
    staff_user_id uuid NOT NULL REFERENCES users(id),
    old_values jsonb NOT NULL,
    new_values jsonb NOT NULL,
    note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 500),
    request_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_product_audit_product ON admin_product_audit(school_id,product_id,created_at DESC);
CREATE TRIGGER admin_product_audit_immutable BEFORE UPDATE OR DELETE ON admin_product_audit
    FOR EACH ROW EXECUTE FUNCTION append_only_guard();
