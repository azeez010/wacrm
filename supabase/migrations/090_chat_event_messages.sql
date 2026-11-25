-- ============================================================
-- 090: system "event" lines in a conversation ("Jide just joined the chat").
--
-- A conversation event is stored as a message row so it keeps its place in the
-- timeline for both the visitor's widget and the inbox. It is rendered as a
-- centred, muted line (like WhatsApp's system messages), never as a bubble.
-- sender_type stays 'bot'; sender_id is the teammate it is about; content_text
-- holds their display name.
-- ============================================================
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'event'
  ));
