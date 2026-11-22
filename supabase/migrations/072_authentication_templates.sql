-- ============================================================
-- 072_authentication_templates
--
-- Authentication (OTP) templates. Meta writes the wording; we only choose
-- a few options, stored here so the template can be shown and re-created:
--   { "add_security_recommendation": true,
--     "code_expiration_minutes": 10,
--     "otp_type": "COPY_CODE" }
-- NULL for every other category. Idempotent.
-- ============================================================

ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS auth_config JSONB;

COMMENT ON COLUMN message_templates.auth_config IS
  'Options of an AUTHENTICATION template (add_security_recommendation, code_expiration_minutes, otp_type). NULL for other categories.';

-- ============================================================
-- OTP verifications (POST /api/v1/verifications)
--
-- One row per code we send. The code itself is never stored: only an
-- HMAC-SHA256 of (id, code) with a server secret. Service role only: no
-- policies, so RLS denies everyone else.
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,                       -- digits only, as sent to Meta
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'failed', 'expired', 'canceled')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE SET NULL,
  message_row_id UUID REFERENCES messages(id) ON DELETE SET NULL, -- our messages.id
  metadata JSONB,
  send_error TEXT,                           -- why the send itself failed
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_phone
  ON otp_verifications (account_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_verifications_message
  ON otp_verifications (message_row_id) WHERE message_row_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_verifications_created
  ON otp_verifications (created_at);

ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;

-- Atomically spend one guess. Returns the row only if the verification is
-- still pending, unexpired and has attempts left, so concurrent guesses can
-- never exceed max_attempts.
CREATE OR REPLACE FUNCTION otp_register_attempt(p_id UUID, p_account UUID)
RETURNS TABLE (code_hash TEXT, attempts INTEGER, max_attempts INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE otp_verifications v
     SET attempts = v.attempts + 1
   WHERE v.id = p_id
     AND v.account_id = p_account
     AND v.status = 'pending'
     AND v.expires_at > NOW()
     AND v.attempts < v.max_attempts
  RETURNING v.code_hash, v.attempts, v.max_attempts;
$$;

REVOKE ALL ON FUNCTION otp_register_attempt(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otp_register_attempt(UUID, UUID) TO service_role;
