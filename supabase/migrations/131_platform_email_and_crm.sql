-- ============================================================
-- 131_platform_email_and_crm.sql
-- Platform email and CRM, configured in the admin console (Platform settings) instead of environment variables.
--
--   admin.email_instances   email provider instances (Brevo, Resend, SendGrid, Postmark, Mailgun, Amazon SES), in priority
--                           order. Every platform email (welcome, quota, reminders, sign-in codes, admin notices) is tried
--                           on the first healthy instance and fails over to the next. Secrets are encrypted by the admin API
--                           with PLATFORM_SECRETS_KEY (same format as payment and AI instances) and are write-only.
--                           After 3 failures in a row an instance cools down for 5 minutes (tried last meanwhile).
--   admin.email_settings    the default sender (from address, name, reply-to).
--   admin.crm_settings      OgaDesk's own CRM: the OgaDesk business's workspace in the app, reached through its public API
--                           with an API key created there (encrypted). Signups and lifecycle events become contacts there.
-- Provider types live in code (wacrm src/lib/email/providers.ts, byte-identical copies in the admin API and console).
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin.email_instances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,30}$'),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  enabled              boolean NOT NULL DEFAULT false,
  priority             integer NOT NULL DEFAULT 100,
  config               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secrets              text,
  secret_hints         jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0,
  cooldown_until       timestamptz,
  last_ok_at           timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  sent_count           bigint NOT NULL DEFAULT 0,
  created_by           uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_instances_order_idx ON admin.email_instances (priority, created_at);

CREATE TABLE IF NOT EXISTS admin.email_settings (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  from_address text CHECK (from_address IS NULL OR from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  from_name    text CHECK (from_name IS NULL OR char_length(from_name) <= 80),
  reply_to     text CHECK (reply_to IS NULL OR reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_by   uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin.email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin.crm_settings (
  id             integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled        boolean NOT NULL DEFAULT false,
  base_url       text NOT NULL DEFAULT 'https://ogadesk.com' CHECK (base_url ~ '^https://[^/\s]+$'),
  api_key        text,              -- encrypted with PLATFORM_SECRETS_KEY
  api_key_hint   text,
  workspace_id   uuid,              -- filled by "Test": the workspace the key belongs to (its own signups are not synced)
  workspace_name text,
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  last_error     text,
  updated_by     uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin.crm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE admin.email_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.crm_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.email_instances, admin.email_settings, admin.crm_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.email_instances TO ogadesk_admin_api;
GRANT SELECT, UPDATE ON admin.email_settings, admin.crm_settings TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.email_instances;
CREATE POLICY admin_api_all ON admin.email_instances FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.email_settings;
CREATE POLICY admin_api_all ON admin.email_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.crm_settings;
CREATE POLICY admin_api_all ON admin.crm_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

-- Everything the app needs to send: the sender and the enabled instances in order (healthy first, cooling down last),
-- with their still-encrypted secrets. Service role only.
CREATE OR REPLACE FUNCTION public.email_platform_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'sender', (SELECT jsonb_build_object('fromAddress', from_address, 'fromName', from_name, 'replyTo', reply_to) FROM admin.email_settings WHERE id = 1),
    'instances', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'config', i.config, 'secrets', i.secrets)
                       ORDER BY (i.cooldown_until IS NOT NULL AND i.cooldown_until > now()), i.priority, i.created_at)
        FROM admin.email_instances i WHERE i.enabled), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.email_instance_report(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
BEGIN
  IF p_ok THEN
    UPDATE admin.email_instances SET consecutive_failures = 0, cooldown_until = NULL, last_ok_at = now(), sent_count = sent_count + 1 WHERE id = p_id;
  ELSE
    UPDATE admin.email_instances
       SET consecutive_failures = consecutive_failures + 1, last_error_at = now(), last_error = left(p_error, 300),
           cooldown_until = CASE WHEN consecutive_failures + 1 >= 3 THEN now() + interval '5 minutes' ELSE cooldown_until END
     WHERE id = p_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.crm_platform_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object('enabled', enabled, 'baseUrl', base_url, 'apiKey', api_key, 'workspaceId', workspace_id)
    FROM admin.crm_settings WHERE id = 1
$$;

CREATE OR REPLACE FUNCTION public.crm_report(p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, admin
AS $$
  UPDATE admin.crm_settings
     SET last_ok_at = CASE WHEN p_ok THEN now() ELSE last_ok_at END,
         last_error_at = CASE WHEN p_ok THEN last_error_at ELSE now() END,
         last_error = CASE WHEN p_ok THEN last_error ELSE left(p_error, 300) END
   WHERE id = 1
$$;

REVOKE ALL ON FUNCTION public.email_platform_config(), public.email_instance_report(uuid, boolean, text),
                       public.crm_platform_config(), public.crm_report(boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_platform_config(), public.email_instance_report(uuid, boolean, text),
                          public.crm_platform_config(), public.crm_report(boolean, text) TO service_role;
