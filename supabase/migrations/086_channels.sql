-- 086: channels
--
-- A conversation now belongs to a channel (WhatsApp today, website live chat
-- next, more later). Existing rows are WhatsApp via the column default.
--
--  * conversations.channel   - which channel the thread lives on.
--  * conversations.form_id   - the widget (forms row) a website chat came from.
--  * One thread per (account, contact, CHANNEL) instead of per (account,
--    contact), so a person on WhatsApp and on the website chat keeps one
--    contact but two threads. The new index is created before the old one is
--    dropped, so there is no window without a guarantee.
--  * contacts.web_visitor_id - stable anonymous id of a website visitor, the
--    web twin of wa_user_id (040).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check CHECK (channel IN ('whatsapp', 'web_chat'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS form_id UUID REFERENCES forms(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel);

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations (account_id, channel);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS web_visitor_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_web_visitor_id
  ON contacts (account_id, web_visitor_id)
  WHERE web_visitor_id IS NOT NULL;

COMMENT ON COLUMN conversations.channel IS
  'Channel the thread lives on: whatsapp | web_chat. Widen the CHECK to add channels.';
COMMENT ON COLUMN contacts.web_visitor_id IS
  'Anonymous id of a website live-chat visitor (stable per browser).';
