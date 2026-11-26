-- ============================================================
-- 112_admin_integration_settings.sql
-- Platform integration settings managed in the admin console (Platform settings → WhatsApp (Meta)).
-- Until now these were Worker environment variables. The app reads the console value first and falls
-- back to its environment (src/lib/platform-config.ts), so nothing changes until a value is saved.
--   admin.integration_settings        key, plain value, or an encrypted secret (PLATFORM_SECRETS_KEY)
--   public.platform_integration_values()   everything, for the app (service role only; secrets stay encrypted)
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin.integration_settings (
  key          text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  value        text,                -- plain (non-secret) value
  secret_value text,                -- AES-256-GCM blob (secrets)
  secret_hint  text,                -- ••••1234, display only
  updated_by   uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(value, secret_value) = 1)
);
ALTER TABLE admin.integration_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.integration_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.integration_settings TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.integration_settings;
CREATE POLICY admin_api_all ON admin.integration_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.platform_integration_values()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('value', value, 'secret', secret_value)), '{}'::jsonb) FROM admin.integration_settings
$$;
REVOKE ALL ON FUNCTION public.platform_integration_values() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_integration_values() TO service_role;
