-- 内容安全覆盖教材建议的自由文本（书名、作者、出版社、版次、备注）：
-- content_safety_events.scene 增加 TEXTBOOK_SUGGESTION。仍然只记录原因与文本指纹，不保存原文。
-- 只新增，不修改 V1～V19。
ALTER TABLE content_safety_events DROP CONSTRAINT content_safety_events_scene_check;
ALTER TABLE content_safety_events ADD CONSTRAINT content_safety_events_scene_check
    CHECK (scene IN ('PRODUCT', 'COMMENT', 'MESSAGE', 'PROFILE', 'CIRCLE', 'TEXTBOOK_SUGGESTION'));
