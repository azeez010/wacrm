-- ============================================================
-- 096_admin_platform_settings.sql
--
-- Platform settings and AI controls for the admin console:
--  * admin.platform_settings : single row; the global AI switch (kill switch)
--  * admin.ai_overrides      : per-business "AI off" switch set by an admin
--  * public.ai_admin_gate()  : what the app asks before using AI for an account
--  * admin.ai_accounts() / admin.ai_usage_daily(): AI monitoring, counts only
--    (never API keys, prompts or knowledge content)
--  * grants so the admin API can edit currency settings / rate overrides and
--    the partner program, and suspend or reinstate partners.
-- Additive only; AI stays enabled everywhere until an admin flips a switch.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin.platform_settings (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ai_enabled         boolean NOT NULL DEFAULT true,
  ai_disabled_reason text,
  updated_by         uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin.ai_overrides (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  disabled   boolean NOT NULL DEFAULT true,
  reason     text,
  updated_by uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.ai_overrides      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.platform_settings, admin.ai_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON admin.platform_settings TO ogadesk_admin_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.ai_overrides TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.platform_settings;
CREATE POLICY admin_api_all ON admin.platform_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.ai_overrides;
CREATE POLICY admin_api_all ON admin.ai_overrides FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- The gate the app checks before generating any AI reply/draft.
-- Returns {"allowed": bool, "scope": "platform" | "account" | null}.
-- The admin's reason is NOT returned (it can be internal). A signed-in
-- caller only learns about accounts they belong to; for any other account
-- the answer is always "allowed" so nothing leaks.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_admin_gate(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
  platform_on boolean;
  account_off boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_account_member(p_account, 'viewer') THEN
    RETURN jsonb_build_object('allowed', true, 'scope', NULL);
  END IF;
  SELECT ai_enabled INTO platform_on FROM admin.platform_settings WHERE id = 1;
  IF platform_on IS FALSE THEN
    RETURN jsonb_build_object('allowed', false, 'scope', 'platform');
  END IF;
  SELECT disabled INTO account_off FROM admin.ai_overrides WHERE account_id = p_account;
  IF account_off IS TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'scope', 'account');
  END IF;
  RETURN jsonb_build_object('allowed', true, 'scope', NULL);
END $$;

REVOKE ALL ON FUNCTION public.ai_admin_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_admin_gate(uuid) TO authenticated, service_role, ogadesk_admin_api;

-- ------------------------------------------------------------
-- AI monitoring for the admin API: per-account setup + usage, counts only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin.ai_accounts(p_days integer)
RETURNS TABLE (
  account_id uuid, account_name text, provider text, model text, is_active boolean,
  auto_reply_enabled boolean, has_key boolean, override_disabled boolean, override_reason text,
  tokens bigint, calls bigint, auto_replies bigint, last_used_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH usage AS (
    SELECT u.account_id, sum(u.total_tokens)::bigint AS tokens, count(*)::bigint AS calls,
           count(*) FILTER (WHERE u.mode = 'auto_reply')::bigint AS auto_replies, max(u.created_at) AS last_used_at
      FROM ai_usage_log u
     WHERE u.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
     GROUP BY u.account_id
  )
  SELECT a.id, a.name, c.provider, c.model, coalesce(c.is_active, false), coalesce(c.auto_reply_enabled, false),
         (c.api_key IS NOT NULL AND c.api_key <> ''), coalesce(o.disabled, false), o.reason,
         coalesce(us.tokens, 0), coalesce(us.calls, 0), coalesce(us.auto_replies, 0), us.last_used_at
    FROM accounts a
    JOIN ai_configs c ON c.account_id = a.id
    LEFT JOIN usage us ON us.account_id = a.id
    LEFT JOIN admin.ai_overrides o ON o.account_id = a.id
$$;

CREATE OR REPLACE FUNCTION admin.ai_usage_daily(p_days integer)
RETURNS TABLE (day date, tokens bigint, calls bigint, accounts bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  SELECT (u.created_at AT TIME ZONE 'utc')::date, sum(u.total_tokens)::bigint, count(*)::bigint, count(DISTINCT u.account_id)::bigint
    FROM ai_usage_log u
   WHERE u.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
   GROUP BY 1 ORDER BY 1
$$;

REVOKE ALL ON FUNCTION admin.ai_accounts(integer), admin.ai_usage_daily(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.ai_accounts(integer), admin.ai_usage_daily(integer) TO ogadesk_admin_api;

-- ------------------------------------------------------------
-- Currency settings, rate overrides and their audit trail (081).
-- ------------------------------------------------------------
GRANT SELECT, UPDATE ON public.currency_settings TO ogadesk_admin_api;
GRANT SELECT, INSERT, UPDATE ON public.exchange_rates TO ogadesk_admin_api;
GRANT SELECT, INSERT ON public.currency_audit_log TO ogadesk_admin_api;
GRANT USAGE ON SEQUENCE public.currency_audit_log_id_seq TO ogadesk_admin_api;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['currency_settings', 'exchange_rates', 'currency_audit_log'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_api_all ON public.%I', t);
    EXECUTE format('CREATE POLICY admin_api_all ON public.%I FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Partner program (080): edit settings, suspend/reinstate partners.
-- 088 granted SELECT on all of partners; narrow it to the columns the
-- console shows so payout_details (bank details) is unreadable to it.
-- ------------------------------------------------------------
GRANT UPDATE ON public.partner_settings TO ogadesk_admin_api;
REVOKE SELECT ON public.partners FROM ogadesk_admin_api;
GRANT SELECT (user_id, code, display_name, show_on_leaderboard, status, clicks, created_at, updated_at) ON public.partners TO ogadesk_admin_api;
GRANT UPDATE (status, updated_at) ON public.partners TO ogadesk_admin_api;
