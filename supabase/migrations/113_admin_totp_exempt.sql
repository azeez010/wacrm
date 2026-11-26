-- ============================================================
-- 113_admin_totp_exempt.sql
-- Per-admin 2FA switch for the admin console. A superadmin can turn two-factor
-- off for one admin (they then sign in with a password alone) and back on.
-- Enrolled secrets are kept. Platform-wide switch: 109 (admin_totp_required).
-- Additive, idempotent.
-- ============================================================
ALTER TABLE admin.admin_users
  ADD COLUMN IF NOT EXISTS totp_exempt        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_exempt_reason text;
