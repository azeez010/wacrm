-- ============================================================
-- 079_api_key_secrets.sql
--
-- Lets an admin re-show a key's setup instructions (after confirming
-- their password) by keeping the key's plaintext ENCRYPTED, in its own
-- table. Keys created before this migration have no row here (only their
-- hash exists), so they can never be re-shown.
--
-- RLS is enabled with NO policies on purpose: nobody can read this table
-- through the Supabase client, not even the ciphertext. Only the server
-- (service role), after checking role + password, ever touches it.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_key_secrets (
  key_id           uuid PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_key_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_key_secrets FROM anon, authenticated;
