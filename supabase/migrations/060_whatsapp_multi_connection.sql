-- ============================================================
-- 060_whatsapp_multi_connection.sql — multiple WhatsApp numbers
-- per account, "shared" (Embedded Signup) vs "custom" (BYO Meta
-- App) connection modes.
--
-- Was: UNIQUE(account_id) on whatsapp_config — exactly one number
-- per account (added in 017_account_sharing.sql). An account can
-- now hold several connections: any number of 'custom' rows (each
-- with its own Meta App credentials, exactly as before) plus any
-- number of 'shared' rows (onboarded via the platform operator's
-- Tech Provider Embedded Signup — no per-row token stored; every
-- shared connection's Graph API calls reuse one platform-level
-- system-user token from env, since Meta's Tech Provider permission
-- model already grants that token access to any WABA that completed
-- Embedded Signup).
--
-- `account_id` stays NOT NULL throughout — there is no pool of
-- spare/unassigned numbers. Every row belongs to an account from
-- the moment it's created, custom or shared alike.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_config_mode_enum') THEN
    CREATE TYPE whatsapp_config_mode_enum AS ENUM ('shared', 'custom');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_signup_type_enum') THEN
    CREATE TYPE whatsapp_signup_type_enum AS ENUM ('new_number', 'existing_number');
  END IF;
END $$;

-- ============================================================
-- whatsapp_config: lift the one-per-account constraint
-- ============================================================
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS mode whatsapp_config_mode_enum NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS signup_type whatsapp_signup_type_enum,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS display_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS verified_name TEXT;

-- Every existing row was manually entered under the account's own
-- Meta App — backfill to 'custom' explicitly (defensive; DEFAULT
-- already covers it for pre-existing rows since the column is new).
UPDATE whatsapp_config SET mode = 'custom' WHERE mode IS NULL;

-- Shared rows never store a token (platform system-user token is
-- reused instead); custom rows always need their own.
ALTER TABLE whatsapp_config ALTER COLUMN access_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_signup_type_shared_only'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_signup_type_shared_only
      CHECK (mode = 'shared' OR signup_type IS NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_custom_requires_credentials'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_custom_requires_credentials
      CHECK (mode <> 'custom' OR (access_token IS NOT NULL AND verify_token IS NOT NULL));
  END IF;
END $$;

-- ============================================================
-- conversations / message_templates: which connection owns this row
--
-- Nullable permanently (not just during backfill) — a deleted
-- connection must not break historical conversations/templates.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;
ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config ON conversations(whatsapp_config_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_whatsapp_config ON message_templates(whatsapp_config_id);

-- Backfill: every account today has exactly one whatsapp_config row
-- (the pre-060 invariant), so this is unambiguous.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND c.whatsapp_config_id IS NULL;

UPDATE message_templates mt
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = mt.account_id
  AND mt.whatsapp_config_id IS NULL;

-- ============================================================
-- message_templates: per-WABA uniqueness, not just per-account
--
-- A template name/language pair can legitimately repeat across two
-- different WABAs on the same account (two connections, two separate
-- Meta template catalogs). Swap the account-level unique index
-- (057_message_templates_account_unique.sql) for a connection-level
-- one, keeping an account-level fallback for any row that predates
-- backfill (whatsapp_config_id IS NULL).
-- ============================================================
DROP INDEX IF EXISTS message_templates_account_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_config_name_language_key
  ON message_templates (whatsapp_config_id, name, language)
  WHERE whatsapp_config_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_name_language_key
  ON message_templates (account_id, name, language)
  WHERE whatsapp_config_id IS NULL;

-- ============================================================
-- messages: distinguish "sent via wacrm" from "sent via the
-- WhatsApp Business mobile app" (coexistence echoes)
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'wacrm' CHECK (source IN ('wacrm', 'whatsapp_app'));
