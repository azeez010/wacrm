-- ============================================================
-- 066_typed_custom_fields_and_tables.sql
--
-- Foundation for typed custom fields, custom tables and the
-- "reference" field type.
--
--   * custom_fields gains a stable `key`, ordering, display and
--     governance columns (source/locked for app ownership, archived_at
--     for recoverable deletes, min_role_edit / hidden_from_viewers).
--   * contact_custom_values keeps `value TEXT` as the canonical value
--     and gains typed shadow columns (number / date / bool / text[])
--     plus a denormalised account_id so filters never join through
--     contacts. The shadow columns are written only by the app-side
--     `coerceValue` helper (src/lib/custom-fields).
--   * custom_tables + custom_records: config-driven tables whose
--     columns are ordinary custom_fields rows (custom_fields.table_id).
--
-- Additive and idempotent: safe to re-run, nothing is dropped.
-- ============================================================

-- ------------------------------------------------------------
-- custom_tables (created first so custom_fields.table_id can FK it)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  -- key of the column whose value is the human label of a row
  label_field_key TEXT,
  source          TEXT,                       -- NULL = user-made, else app/pack key
  locked          BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at     TIMESTAMPTZ,
  min_role_edit   account_role_enum NOT NULL DEFAULT 'agent',
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_tables_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_tables_account_key
  ON custom_tables(account_id, key);

-- ------------------------------------------------------------
-- custom_fields: key, ordering, governance
-- ------------------------------------------------------------
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS key                 TEXT,
  ADD COLUMN IF NOT EXISTS table_id            UUID REFERENCES custom_tables(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS show_in_table       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description         TEXT,
  ADD COLUMN IF NOT EXISTS required            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS default_value       TEXT,
  ADD COLUMN IF NOT EXISTS source              TEXT,
  ADD COLUMN IF NOT EXISTS locked              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS min_role_edit       account_role_enum NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS hidden_from_viewers BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill `key` from the field name (slug). Collisions inside one
-- account get a numeric suffix so the unique index below can be built.
WITH slugged AS (
  SELECT
    id,
    account_id,
    COALESCE(
      NULLIF(
        left(
          regexp_replace(
            regexp_replace(lower(field_name), '[^a-z0-9]+', '_', 'g'),
            '^_+|_+$', '', 'g'
          ),
          60
        ),
        ''
      ),
      'field'
    ) AS base,
    created_at
  FROM custom_fields
  WHERE key IS NULL
),
numbered AS (
  SELECT
    id,
    -- keys must start with a letter
    CASE WHEN base ~ '^[a-z]' THEN base ELSE 'f_' || base END AS base,
    row_number() OVER (
      PARTITION BY account_id,
                   CASE WHEN base ~ '^[a-z]' THEN base ELSE 'f_' || base END
      ORDER BY created_at, id
    ) AS rn
  FROM slugged
)
UPDATE custom_fields cf
SET key = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || '_' || n.rn END
FROM numbered n
WHERE cf.id = n.id;

ALTER TABLE custom_fields ALTER COLUMN key SET NOT NULL;

-- Stable ordering for existing fields: oldest first.
UPDATE custom_fields cf
SET sort_order = o.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at, id) AS rn
  FROM custom_fields
) o
WHERE cf.id = o.id AND cf.sort_order = 0;

-- Contact fields (table_id NULL) and each table's columns have their
-- own key namespace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_fields_scope_key
  ON custom_fields(
    account_id,
    COALESCE(table_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key
  );
CREATE INDEX IF NOT EXISTS idx_custom_fields_table ON custom_fields(table_id)
  WHERE table_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_type_check'
  ) THEN
    ALTER TABLE custom_fields
      ADD CONSTRAINT custom_fields_type_check
      CHECK (field_type IN
        ('text', 'number', 'bool', 'date', 'enum', 'multi_enum', 'reference'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_key_format'
  ) THEN
    ALTER TABLE custom_fields
      ADD CONSTRAINT custom_fields_key_format
      CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$');
  END IF;
END $$;

-- ------------------------------------------------------------
-- contact_custom_values: typed shadow columns + account_id
-- ------------------------------------------------------------
ALTER TABLE contact_custom_values
  ADD COLUMN IF NOT EXISTS account_id        UUID REFERENCES accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS value_number      NUMERIC,
  ADD COLUMN IF NOT EXISTS value_date        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS value_bool        BOOLEAN,
  ADD COLUMN IF NOT EXISTS value_text_array  TEXT[];

UPDATE contact_custom_values v
SET account_id = c.account_id
FROM contacts c
WHERE c.id = v.contact_id AND v.account_id IS NULL;

-- Keep account_id correct no matter which writer inserts the row.
CREATE OR REPLACE FUNCTION set_contact_custom_value_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    SELECT c.account_id INTO NEW.account_id
    FROM contacts c WHERE c.id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_custom_value_account ON contact_custom_values;
CREATE TRIGGER trg_contact_custom_value_account
  BEFORE INSERT ON contact_custom_values
  FOR EACH ROW EXECUTE FUNCTION set_contact_custom_value_account();

CREATE INDEX IF NOT EXISTS idx_ccv_account_field_number
  ON contact_custom_values(account_id, custom_field_id, value_number)
  WHERE value_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ccv_account_field_date
  ON contact_custom_values(account_id, custom_field_id, value_date)
  WHERE value_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ccv_account_field_bool
  ON contact_custom_values(account_id, custom_field_id, value_bool)
  WHERE value_bool IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ccv_account_field_text
  ON contact_custom_values(account_id, custom_field_id, value);
CREATE INDEX IF NOT EXISTS idx_ccv_text_array
  ON contact_custom_values USING GIN (value_text_array)
  WHERE value_text_array IS NOT NULL;

-- ------------------------------------------------------------
-- custom_records
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  table_id    UUID NOT NULL REFERENCES custom_tables(id) ON DELETE CASCADE,
  -- derived from the table's label field; used by reference pickers
  label       TEXT NOT NULL DEFAULT '',
  -- values keyed by field key
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_records_table_label
  ON custom_records(table_id, label);
CREATE INDEX IF NOT EXISTS idx_custom_records_account
  ON custom_records(account_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE custom_tables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_tables_select ON custom_tables;
DROP POLICY IF EXISTS custom_tables_insert ON custom_tables;
DROP POLICY IF EXISTS custom_tables_update ON custom_tables;
DROP POLICY IF EXISTS custom_tables_delete ON custom_tables;
CREATE POLICY custom_tables_select ON custom_tables FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY custom_tables_insert ON custom_tables FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY custom_tables_update ON custom_tables FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY custom_tables_delete ON custom_tables FOR DELETE
  USING (is_account_member(account_id, 'admin') AND NOT locked);

-- Rows: members read, agents (or admins for admin-only tables) write.
DROP POLICY IF EXISTS custom_records_select ON custom_records;
DROP POLICY IF EXISTS custom_records_modify ON custom_records;
CREATE POLICY custom_records_select ON custom_records FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY custom_records_modify ON custom_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM custom_tables t
      WHERE t.id = custom_records.table_id
        AND is_account_member(t.account_id, t.min_role_edit)
    )
  )
  WITH CHECK (
    account_id = (SELECT t.account_id FROM custom_tables t WHERE t.id = custom_records.table_id)
    AND EXISTS (
      SELECT 1 FROM custom_tables t
      WHERE t.id = custom_records.table_id
        AND is_account_member(t.account_id, t.min_role_edit)
    )
  );

-- Locked (app-owned) fields cannot be deleted by users.
DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;
CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE
  USING (is_account_member(account_id, 'admin') AND NOT locked);

-- Values: agents write, unless the field demands a higher role.
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM contacts c
      JOIN custom_fields f ON f.id = contact_custom_values.custom_field_id
      WHERE c.id = contact_custom_values.contact_id
        AND is_account_member(c.account_id, f.min_role_edit)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM contacts c
      JOIN custom_fields f ON f.id = contact_custom_values.custom_field_id
      WHERE c.id = contact_custom_values.contact_id
        AND is_account_member(c.account_id, f.min_role_edit)
    )
  );

-- Viewers cannot read values of fields hidden from viewers.
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM contacts c
      JOIN custom_fields f ON f.id = contact_custom_values.custom_field_id
      WHERE c.id = contact_custom_values.contact_id
        AND is_account_member(c.account_id)
        AND (NOT f.hidden_from_viewers OR is_account_member(c.account_id, 'agent'))
    )
  );

-- ------------------------------------------------------------
-- redeem_invitation: the new account-scoped tables count as "has data"
-- so an account with custom tables/rows is never silently deleted when
-- its owner joins another account. (Body identical to 047 plus 3 checks.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_tables WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_records WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_custom_values WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
