-- ============================================================
-- 088_admin_schema.sql
--
-- Platform-admin console storage (admin.ogadesk.com / api.ogadesk.com).
--
-- Everything admin-owned lives in a dedicated `admin` schema that PostgREST
-- does not expose, with RLS on and no policies, so the anon / authenticated
-- keys can never read or write it. The admin API connects with a separate
-- least-privilege role (`ogadesk_admin_api`), never the postgres superuser.
--
--  * admin.admin_users       : platform admins (separate from Supabase Auth)
--  * admin.admin_sessions    : server-side sessions so a token can be revoked
--  * admin.admin_api_keys    : admin API / MCP keys (sha256 hashes only)
--  * admin.admin_audit_log   : append-only trail of every admin action
--  * admin.blog_posts        : marketing blog
--  * admin.metrics_snapshots : daily per-account MRR facts for Growth
--
-- The role is created NOLOGIN here. Give it a login out-of-band, never in
-- a migration:  ALTER ROLE ogadesk_admin_api WITH LOGIN PASSWORD '...';
-- Idempotent.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS admin;
REVOKE ALL ON SCHEMA admin FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ogadesk_admin_api') THEN
    CREATE ROLE ogadesk_admin_api NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin.admin_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text,
  role                text NOT NULL DEFAULT 'support' CHECK (role IN ('support', 'superadmin')),
  capabilities        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  totp_secret_enc     text,
  totp_enabled        boolean NOT NULL DEFAULT false,
  setup_token_version integer NOT NULL DEFAULT 0,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  invited_by          uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_key ON admin.admin_users (lower(email));

CREATE TABLE IF NOT EXISTS admin.admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES admin.admin_users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin.admin_sessions (admin_id);

CREATE TABLE IF NOT EXISTS admin.admin_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES admin.admin_users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS admin_api_keys_admin_idx ON admin.admin_api_keys (admin_id);

CREATE TABLE IF NOT EXISTS admin.admin_audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_email text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  ip          text,
  user_agent  text,
  before      jsonb,
  after       jsonb,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_audit_log_at_idx     ON admin.admin_audit_log (at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx  ON admin.admin_audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin.admin_audit_log (target_type, target_id);

CREATE TABLE IF NOT EXISTS admin.blog_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  title            text NOT NULL,
  excerpt          text,
  body_html        text NOT NULL DEFAULT '',
  cover_image_url  text,
  author           text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  meta_title       text,
  meta_description text,
  keywords         jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at     timestamptz,
  created_by       uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_status_pub_idx ON admin.blog_posts (status, published_at DESC);

CREATE TABLE IF NOT EXISTS admin.metrics_snapshots (
  day        date NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id    text,
  status     text,
  mrr        numeric(14, 2) NOT NULL DEFAULT 0,
  currency   text NOT NULL DEFAULT 'NGN',
  PRIMARY KEY (day, account_id)
);

-- updated_at triggers (function already exists in public from earlier migrations)
DROP TRIGGER IF EXISTS set_updated_at ON admin.admin_users;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admin.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON admin.blog_posts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admin.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Lock everything down: RLS on, no policies, no anon/authenticated access
-- ------------------------------------------------------------
ALTER TABLE admin.admin_users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.admin_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.admin_api_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.admin_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.blog_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.metrics_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES    IN SCHEMA admin FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Least-privilege grants for the admin API role
-- ------------------------------------------------------------
GRANT USAGE ON SCHEMA admin TO ogadesk_admin_api;
GRANT USAGE ON SCHEMA public TO ogadesk_admin_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  admin.admin_users, admin.admin_sessions, admin.admin_api_keys,
  admin.blog_posts, admin.metrics_snapshots
  TO ogadesk_admin_api;

-- Audit log is append-only for the API: no UPDATE / DELETE.
GRANT SELECT, INSERT ON admin.admin_audit_log TO ogadesk_admin_api;
GRANT USAGE ON SEQUENCE admin.admin_audit_log_id_seq TO ogadesk_admin_api;

-- Customer data the console reads. Writes only where an admin action needs them.
GRANT SELECT ON public.accounts, public.profiles, public.partners,
  public.referrals, public.partner_settings TO ogadesk_admin_api;
GRANT SELECT, INSERT, UPDATE ON public.plans TO ogadesk_admin_api;
GRANT SELECT, UPDATE ON public.account_subscriptions TO ogadesk_admin_api;
GRANT SELECT, INSERT, UPDATE ON public.subscription_payments TO ogadesk_admin_api;

-- The API role must bypass RLS on the public tables it reads, but ONLY
-- through the grants above (it has no BYPASSRLS attribute), so give it
-- explicit read/write policies instead of blanket bypass.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'profiles', 'partners', 'referrals', 'partner_settings',
    'plans', 'account_subscriptions', 'subscription_payments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_api_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY admin_api_all ON public.%I FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Admin tables need a permissive policy for the API role too (RLS is on).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'admin_users', 'admin_sessions', 'admin_api_keys', 'admin_audit_log',
    'blog_posts', 'metrics_snapshots'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_api_all ON admin.%I', t);
    EXECUTE format(
      'CREATE POLICY admin_api_all ON admin.%I FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
