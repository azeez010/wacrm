-- ============================================================
-- 115_ai_platform.sql
--
-- Platform-powered AI. The admin console configures AI PROVIDER INSTANCES (OpenAI, Anthropic, OpenAI-compatible,
-- OpenRouter, DeepSeek...), chained for automatic failover; a business uses them by default (an ai_configs row
-- with api_key NULL) or brings its own key. Platform usage is counted against the plan's token credits.
--
--   admin.ai_instances        instances + health + prices + optional manual budget
--   admin.ai_settings         single row: failover tuning + the default persona and hard guardrails
--   public.ai_route(purpose)  ordered instances with exclusion reasons (the chat executor and the admin simulator)
--   public.ai_instance_secrets / ai_instance_report   service role only
--   public.ai_credit_status(account)   {allowed, reason, used, limit, remaining, percent} (platform tokens this month)
--   public.ai_platform_prompt()        guardrails + persona defaults (service role)
--   public.ai_platform_persona()       the editable persona defaults, for placeholders in the customer UI
--
-- Credits are the plan limit `ai_tokens_per_month`: a MISSING key means 0 (no platform AI), an explicit null means
-- unlimited (the Plans editor's blank box), a number is the monthly allowance. The plan feature `ai_assistant` must be
-- on. Platform AI only: a business's own key is never counted or limited.
-- Secrets are AES-256-GCM encrypted with PLATFORM_SECRETS_KEY (same as payments). Idempotent.
-- ============================================================

-- ---- businesses may use the platform instead of a key of their own ----
ALTER TABLE public.ai_configs ALTER COLUMN api_key DROP NOT NULL;

-- ---- any provider kind in the usage log, plus what a call cost and who served it ----
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$');
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'own' CHECK (source IN ('own', 'platform')),
  ADD COLUMN IF NOT EXISTS instance_id uuid,
  ADD COLUMN IF NOT EXISTS cost_usd    numeric(12,6),
  ADD COLUMN IF NOT EXISTS attempts    jsonb;
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_mode_check CHECK (mode IN ('auto_reply', 'draft', 'playground'));
CREATE INDEX IF NOT EXISTS ai_usage_log_platform_idx ON public.ai_usage_log (account_id, created_at DESC) WHERE source = 'platform';
CREATE INDEX IF NOT EXISTS ai_usage_log_instance_idx ON public.ai_usage_log (instance_id, created_at DESC) WHERE instance_id IS NOT NULL;

-- ---- per-agent persona (NULL = inherit the platform default) ----
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS persona_gender    text CHECK (persona_gender IS NULL OR char_length(persona_gender) <= 60),
  ADD COLUMN IF NOT EXISTS persona_tone      text CHECK (persona_tone IS NULL OR char_length(persona_tone) <= 400),
  ADD COLUMN IF NOT EXISTS persona_behaviour text CHECK (persona_behaviour IS NULL OR char_length(persona_behaviour) <= 1500),
  ADD COLUMN IF NOT EXISTS persona_avoid     text CHECK (persona_avoid IS NULL OR char_length(persona_avoid) <= 1500),
  ADD COLUMN IF NOT EXISTS persona_never     text CHECK (persona_never IS NULL OR char_length(persona_never) <= 1500);

-- ---- instances ----
CREATE TABLE IF NOT EXISTS admin.ai_instances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,30}$'),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  enabled              boolean NOT NULL DEFAULT false,
  priority             integer NOT NULL DEFAULT 100,
  uses                 jsonb NOT NULL DEFAULT '["chat","draft","playground"]'::jsonb CHECK (jsonb_typeof(uses) = 'array'),
  model                text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 120),
  config               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secrets              text,
  secret_hints         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- USD per 1M tokens, for the spend estimate and the credit/spend monitor.
  price_in_per_m       numeric(12,4) NOT NULL DEFAULT 0 CHECK (price_in_per_m >= 0),
  price_out_per_m      numeric(12,4) NOT NULL DEFAULT 0 CHECK (price_out_per_m >= 0),
  timeout_ms           integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 3000 AND 120000),
  -- For providers with no balance API: what you topped up, and when; remaining ~ budget - spend since.
  budget_usd           numeric(12,2) CHECK (budget_usd IS NULL OR budget_usd >= 0),
  budget_set_at        timestamptz,
  alert_below_usd      numeric(12,2) CHECK (alert_below_usd IS NULL OR alert_below_usd >= 0),
  consecutive_failures integer NOT NULL DEFAULT 0,
  cooldown_until       timestamptz,
  last_ok_at           timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  created_by           uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_instances_order_idx ON admin.ai_instances (priority, created_at);

CREATE TABLE IF NOT EXISTS admin.ai_settings (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  failure_threshold integer NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 20),
  cooldown_minutes  integer NOT NULL DEFAULT 5 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  -- Default persona (a business can override each field per agent) ...
  persona_name      text CHECK (persona_name IS NULL OR char_length(persona_name) <= 80),
  persona_gender    text CHECK (persona_gender IS NULL OR char_length(persona_gender) <= 60),
  persona_tone      text CHECK (persona_tone IS NULL OR char_length(persona_tone) <= 400),
  persona_behaviour text CHECK (persona_behaviour IS NULL OR char_length(persona_behaviour) <= 1500),
  persona_avoid     text CHECK (persona_avoid IS NULL OR char_length(persona_avoid) <= 1500),
  persona_never     text CHECK (persona_never IS NULL OR char_length(persona_never) <= 1500),
  greeting_style    text CHECK (greeting_style IS NULL OR char_length(greeting_style) <= 400),
  language_rule     text CHECK (language_rule IS NULL OR char_length(language_rule) <= 400),
  max_reply_chars   integer CHECK (max_reply_chars IS NULL OR max_reply_chars BETWEEN 100 AND 4000),
  handoff_rules     text CHECK (handoff_rules IS NULL OR char_length(handoff_rules) <= 1500),
  -- ... and the hard guardrails: always applied, never shown to or editable by customers.
  guardrails        text CHECK (guardrails IS NULL OR char_length(guardrails) <= 6000),
  updated_by        uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE admin.ai_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.ai_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.ai_instances, admin.ai_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.ai_instances TO ogadesk_admin_api;
GRANT SELECT, UPDATE ON admin.ai_settings TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.ai_instances;
CREATE POLICY admin_api_all ON admin.ai_instances FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.ai_settings;
CREATE POLICY admin_api_all ON admin.ai_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

-- ---- routing ----
CREATE OR REPLACE FUNCTION public.ai_route(p_purpose text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'kind', i.kind, 'name', i.name, 'model', i.model, 'priority', i.priority,
           'cooldownUntil', i.cooldown_until,
           'reason', CASE
             WHEN NOT i.enabled THEN 'disabled'
             WHEN NOT (i.uses ? p_purpose) THEN 'purpose'
             WHEN i.cooldown_until IS NOT NULL AND i.cooldown_until > now() THEN 'cooling_down'
           END
         ) ORDER BY i.priority, i.created_at), '[]'::jsonb)
    FROM admin.ai_instances i
$$;

CREATE OR REPLACE FUNCTION public.ai_instance_secrets(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object('id', id, 'kind', kind, 'model', model, 'config', config, 'secrets', secrets, 'timeoutMs', timeout_ms,
                            'priceIn', price_in_per_m, 'priceOut', price_out_per_m)
    FROM admin.ai_instances WHERE id = p_id
$$;

CREATE OR REPLACE FUNCTION public.ai_instance_report(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE s admin.ai_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM admin.ai_settings WHERE id = 1;
  IF p_ok THEN
    UPDATE admin.ai_instances SET consecutive_failures = 0, cooldown_until = NULL, last_ok_at = now() WHERE id = p_id;
  ELSE
    UPDATE admin.ai_instances
       SET consecutive_failures = consecutive_failures + 1, last_error_at = now(), last_error = left(p_error, 300),
           cooldown_until = CASE WHEN consecutive_failures + 1 >= coalesce(s.failure_threshold, 3)
                                 THEN now() + make_interval(mins => coalesce(s.cooldown_minutes, 5)) ELSE cooldown_until END
     WHERE id = p_id;
  END IF;
END $$;

-- ---- credits ----
CREATE OR REPLACE FUNCTION public.ai_credit_status(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  sub account_subscriptions%ROWTYPE;
  v_plan text;
  v_plan_row plans%ROWTYPE;
  v_limits jsonb;
  v_feats jsonb;
  v_raw jsonb;
  v_limit numeric;
  v_unlimited boolean := false;
  v_used bigint;
  v_feature boolean;
BEGIN
  -- A signed-in caller may only ask about their own business (same rule as the other gates).
  IF auth.uid() IS NOT NULL AND NOT public.is_account_member(p_account, 'viewer') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_member');
  END IF;
  SELECT * INTO sub FROM account_subscriptions WHERE account_id = p_account;
  -- A lapsed subscription counts as the free plan (same rule as billing entitlements).
  v_plan := CASE WHEN sub.account_id IS NOT NULL AND sub.status IN ('active', 'trialing') THEN sub.plan_id ELSE 'free' END;
  SELECT * INTO v_plan_row FROM plans WHERE id = v_plan;
  v_limits := coalesce(v_plan_row.limits, '{}'::jsonb);
  v_feats := coalesce(v_plan_row.features, '{}'::jsonb) || coalesce(CASE WHEN v_plan = sub.plan_id THEN sub.feature_overrides END, '{}'::jsonb);
  v_raw := CASE WHEN CASE WHEN v_plan = sub.plan_id THEN sub.limit_overrides ? 'ai_tokens_per_month' ELSE false END
                THEN sub.limit_overrides -> 'ai_tokens_per_month'
                ELSE v_limits -> 'ai_tokens_per_month' END;
  v_feature := coalesce((v_feats ->> 'ai_assistant')::boolean, false);
  IF NOT v_feature THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'plan_feature', 'plan', v_plan, 'used', 0, 'limit', 0, 'remaining', 0, 'percent', 100);
  END IF;
  -- missing key = 0; json null = unlimited; number = allowance
  IF v_raw IS NULL THEN v_limit := 0;
  ELSIF jsonb_typeof(v_raw) = 'null' THEN v_unlimited := true; v_limit := NULL;
  ELSE v_limit := (v_raw #>> '{}')::numeric; END IF;
  SELECT coalesce(sum(total_tokens), 0) INTO v_used FROM ai_usage_log
   WHERE account_id = p_account AND source = 'platform' AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
  IF v_unlimited THEN
    RETURN jsonb_build_object('allowed', true, 'reason', NULL, 'plan', v_plan, 'used', v_used, 'limit', NULL, 'remaining', NULL, 'percent', 0);
  END IF;
  RETURN jsonb_build_object(
    'allowed', v_used < v_limit, 'reason', CASE WHEN v_used < v_limit THEN NULL ELSE 'credits_exhausted' END, 'plan', v_plan,
    'used', v_used, 'limit', v_limit, 'remaining', greatest(v_limit - v_used, 0),
    'percent', CASE WHEN v_limit <= 0 THEN 100 ELSE least(100, floor(v_used * 100 / v_limit)) END);
END $$;

-- ---- default persona / guardrails ----
CREATE OR REPLACE FUNCTION public.ai_platform_prompt()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'guardrails', guardrails, 'name', persona_name, 'gender', persona_gender, 'tone', persona_tone, 'behaviour', persona_behaviour,
    'avoid', persona_avoid, 'never', persona_never, 'greetingStyle', greeting_style, 'languageRule', language_rule,
    'maxReplyChars', max_reply_chars, 'handoffRules', handoff_rules)
    FROM admin.ai_settings WHERE id = 1
$$;

-- The editable defaults only (the hard guardrails are never exposed), for the placeholders in the customer's AI settings.
CREATE OR REPLACE FUNCTION public.ai_platform_persona()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object('name', persona_name, 'gender', persona_gender, 'tone', persona_tone, 'behaviour', persona_behaviour,
                            'avoid', persona_avoid, 'never', persona_never)
    FROM admin.ai_settings WHERE id = 1
$$;

REVOKE ALL ON FUNCTION public.ai_route(text), public.ai_instance_secrets(uuid), public.ai_instance_report(uuid, boolean, text),
  public.ai_credit_status(uuid), public.ai_platform_prompt(), public.ai_platform_persona() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_route(text), public.ai_credit_status(uuid), public.ai_platform_prompt() TO service_role, ogadesk_admin_api;
GRANT EXECUTE ON FUNCTION public.ai_instance_secrets(uuid), public.ai_instance_report(uuid, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_credit_status(uuid), public.ai_platform_persona() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_platform_persona() TO service_role;

-- ---- starting credits (editable in the admin Plans page); only where the key is not set yet ----
UPDATE public.plans SET limits = limits || jsonb_build_object('ai_tokens_per_month', CASE id WHEN 'free' THEN 0 WHEN 'starter' THEN 300000 WHEN 'pro' THEN 2000000 ELSE 0 END)
 WHERE NOT (limits ? 'ai_tokens_per_month');
