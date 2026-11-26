-- ============================================================
-- 100_form_verification.sql
--
-- Verify-by-code on lead forms (WhatsApp and/or email):
--  * otp_verifications gets a channel (whatsapp | email), the email address for
--    email codes, and consumed_at so a verified proof can be used only once.
--  * contacts remember when their phone / email was proven.
-- Existing rows are WhatsApp codes (the default), so nothing changes for them.
-- Idempotent.
-- ============================================================

ALTER TABLE otp_verifications
  ADD COLUMN IF NOT EXISTS channel     TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS email       TEXT,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE otp_verifications DROP CONSTRAINT IF EXISTS otp_verifications_channel_check;
ALTER TABLE otp_verifications ADD CONSTRAINT otp_verifications_channel_check
  CHECK (channel IN ('whatsapp', 'email'));

CREATE INDEX IF NOT EXISTS idx_otp_verifications_email
  ON otp_verifications (account_id, email, created_at DESC) WHERE email IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
