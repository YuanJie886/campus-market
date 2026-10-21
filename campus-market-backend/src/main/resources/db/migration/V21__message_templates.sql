-- 私信快捷消息：早期私信需要人工审核，默认只允许发送预设的快捷消息（代码里的 MessageTemplates）。
-- messages.template_code 记录这条消息用的是哪条快捷消息；自由文字消息（含此前的全部历史消息）为 NULL。
-- content 仍然保存发送时的文案，历史消息不受以后改文案影响。
-- 只新增，不修改 V1～V20。
ALTER TABLE messages ADD COLUMN template_code text;
ALTER TABLE messages ADD CONSTRAINT messages_template_code_format
    CHECK (template_code IS NULL OR template_code ~ '^[A-Z][A-Z0-9_]{0,63}$');

-- 与 content 一样，template_code 写入后不可修改（V11 的守卫只列出了当时的列，这里补上新列）。
CREATE OR REPLACE FUNCTION messages_moderation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.moderation_quarantine_action_id IS NOT NULL THEN
            RAISE EXCEPTION 'moderated messages cannot be deleted' USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.id, NEW.conversation_id, NEW.sender_id, NEW.content, NEW.created_at, NEW.template_code) IS DISTINCT FROM
       (OLD.id, OLD.conversation_id, OLD.sender_id, OLD.content, OLD.created_at, OLD.template_code) THEN
        RAISE EXCEPTION 'message content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.moderation_quarantined_at IS NULL) = (OLD.moderation_quarantined_at IS NULL)
       AND NEW.moderation_quarantine_action_id IS DISTINCT FROM OLD.moderation_quarantine_action_id THEN
        RAISE EXCEPTION 'message moderation must change visibility' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
