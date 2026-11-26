-- ============================================================
-- 111_payments.sql
--
-- Provider-agnostic customer payments with failover.
--
--   Payment TYPES (Paystack, manual bank transfer, later Flutterwave, Monnify...) live in code
--   (wacrm src/lib/payments/drivers). The admin creates INSTANCES of a type here, each with the
--   countries it serves (auto-ticked from the type, editable), the currencies it can charge, the
--   methods it offers, its config and encrypted secrets, and a priority. Instances are chained in
--   priority order: if one fails, the next one is tried (failover).
--
--   admin.payment_instances       instances + health (consecutive failures, cooldown)
--   admin.payment_settings        single row: collect payments off | test | live, grace/reminder days
--   public.checkout_sessions      one row per customer checkout: chain tried, attempts, outcome
--   public.payment_provider_plans provider-side plan codes for subscriptions (per amount/currency)
--
--   public.payment_route(country, currency, method, mode)  ordered instances WITH exclusion reasons;
--                                                          the checkout and the admin simulator both use it
--   public.payment_quote(plan, interval, currency)         plan price converted + friendly-rounded
--   public.payment_instance_secrets(id)                     service role only (encrypted blob)
--   public.payment_instance_report(id, ok, error)           health bookkeeping (service role only)
--   public.payment_checkout_settings(account)               what the app needs to decide (service role)
--
-- Secrets are AES-256-GCM encrypted with PLATFORM_SECRETS_KEY (a Worker secret shared by the
-- app and the admin API, separate from ENCRYPTION_KEY); the database never sees plaintext.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin.payment_instances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,30}$'),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  enabled              boolean NOT NULL DEFAULT false,
  mode                 text NOT NULL DEFAULT 'test' CHECK (mode IN ('test', 'live')),
  priority             integer NOT NULL DEFAULT 100,
  -- ISO country codes; '*' = every other country. countries_auto: follow the type's coverage.
  countries            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(countries) = 'array'),
  countries_auto       boolean NOT NULL DEFAULT true,
  currencies           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(currencies) = 'array'),
  methods              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(methods) = 'array'),
  config               jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secrets              text,                                  -- encrypted JSON object
  secret_hints         jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { field: "••••1234" } for display only
  consecutive_failures integer NOT NULL DEFAULT 0,
  cooldown_until       timestamptz,
  last_ok_at           timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  created_by           uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_instances_order_idx ON admin.payment_instances (priority, created_at);

CREATE TABLE IF NOT EXISTS admin.payment_settings (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- off: plan changes stay free/manual (today's behaviour); test: only test_account_ids use the
  -- checkout, with TEST instances; live: everyone uses the checkout with LIVE instances.
  collect_payments      text NOT NULL DEFAULT 'off' CHECK (collect_payments IN ('off', 'test', 'live')),
  test_account_ids      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(test_account_ids) = 'array'),
  grace_days            integer NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 30),
  reminder_days         integer NOT NULL DEFAULT 3 CHECK (reminder_days BETWEEN 0 AND 30),
  transfer_expiry_days  integer NOT NULL DEFAULT 7 CHECK (transfer_expiry_days BETWEEN 1 AND 60),
  failure_threshold     integer NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 20),
  cooldown_minutes      integer NOT NULL DEFAULT 10 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  updated_by            uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin.payment_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id          uuid,
  plan_id          text NOT NULL REFERENCES public.plans(id),
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'quarterly', 'annual')),
  method           text NOT NULL CHECK (method IN ('checkout_link', 'subscription', 'bank_transfer')),
  mode             text NOT NULL CHECK (mode IN ('test', 'live')),
  country          text,
  currency         text,
  amount           numeric(14,2),
  base_amount      numeric(14,2),
  base_currency    text,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'redirected', 'awaiting_transfer', 'transfer_reported', 'succeeded', 'failed', 'expired', 'canceled')),
  instance_id      uuid REFERENCES admin.payment_instances(id) ON DELETE SET NULL,
  provider         text,
  checkout_url     text,
  instructions     jsonb,
  attempts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,
  completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS checkout_sessions_account_idx ON public.checkout_sessions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_sessions_open_idx ON public.checkout_sessions (status, expires_at) WHERE status IN ('pending', 'redirected', 'awaiting_transfer', 'transfer_reported');
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account admins read own checkouts" ON public.checkout_sessions;
CREATE POLICY "Account admins read own checkouts" ON public.checkout_sessions FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS public.payment_provider_plans (
  instance_id      uuid NOT NULL REFERENCES admin.payment_instances(id) ON DELETE CASCADE,
  plan_id          text NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  billing_interval text NOT NULL,
  currency         text NOT NULL,
  amount           numeric(14,2) NOT NULL,
  provider_plan_id text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, plan_id, billing_interval, currency, amount)
);
ALTER TABLE public.payment_provider_plans ENABLE ROW LEVEL SECURITY;

-- Any payment type, not just the two that existed in 061/063.
ALTER TABLE public.account_subscriptions DROP CONSTRAINT IF EXISTS account_subscriptions_provider_check;
ALTER TABLE public.account_subscriptions ADD CONSTRAINT account_subscriptions_provider_check CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9_]{1,30}$');
ALTER TABLE public.subscription_payments DROP CONSTRAINT IF EXISTS subscription_payments_provider_check;
ALTER TABLE public.subscription_payments ADD CONSTRAINT subscription_payments_provider_check CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$');
ALTER TABLE public.account_subscriptions
  ADD COLUMN IF NOT EXISTS payment_instance_id uuid REFERENCES admin.payment_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS payment_instance_id uuid REFERENCES admin.payment_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid REFERENCES public.checkout_sessions(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Routing: every instance, in failover order, with why it can or cannot take this payment.
-- charge_currency: the customer's currency when the instance supports it, else the plan's base
-- currency (NGN) when supported, else none (excluded).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_route(p_country text, p_currency text, p_method text, p_mode text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH base AS (SELECT coalesce((SELECT base_currency FROM currency_settings WHERE id = 1), 'NGN') AS cur),
  r AS (
    SELECT i.*,
           CASE WHEN i.currencies ? upper(coalesce(p_currency, '')) THEN upper(p_currency)
                WHEN i.currencies ? (SELECT cur FROM base) THEN (SELECT cur FROM base) END AS charge_currency
      FROM admin.payment_instances i
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'name', r.name, 'mode', r.mode, 'priority', r.priority,
           'chargeCurrency', r.charge_currency,
           'cooldownUntil', r.cooldown_until,
           'reason', CASE
             WHEN NOT r.enabled THEN 'disabled'
             WHEN p_mode IS NOT NULL AND r.mode <> p_mode THEN 'mode'
             WHEN NOT (r.methods ? p_method) THEN 'method'
             WHEN NOT (r.countries ? upper(coalesce(p_country, '')) OR r.countries ? '*') THEN 'country'
             WHEN r.charge_currency IS NULL THEN 'currency'
             WHEN r.cooldown_until IS NOT NULL AND r.cooldown_until > now() THEN 'cooling_down'
           END
         ) ORDER BY r.priority, r.created_at), '[]'::jsonb)
    FROM r
$$;

-- Same rounding as src/lib/currency/convert.ts friendlyRound (parity-tested).
CREATE OR REPLACE FUNCTION public.payment_friendly_round(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR v <= 0 THEN 0
    WHEN v >= 1000 THEN round(v / 10) * 10
    WHEN v >= 100 THEN round(v)
    WHEN v >= 10 THEN round(v * 2) / 2
    ELSE round(v * 20) / 20
  END
$$;

-- Plan price for one interval in p_currency. Returns null when the plan, its price or the rate is missing.
CREATE OR REPLACE FUNCTION public.payment_quote(p_plan text, p_interval text, p_currency text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH p AS (
    SELECT id, currency,
           CASE p_interval WHEN 'monthly' THEN price_monthly WHEN 'quarterly' THEN price_quarterly WHEN 'annual' THEN price_annual END AS price
      FROM plans WHERE id = p_plan AND is_active
  ),
  s AS (SELECT coalesce((SELECT base_currency FROM currency_settings WHERE id = 1), 'NGN') AS base),
  rate AS (
    SELECT (SELECT CASE WHEN p.currency = s.base THEN 1 ELSE (SELECT e.rate FROM exchange_rates e WHERE e.base = s.base AND e.quote = p.currency) END FROM p, s) AS from_rate,
           (SELECT CASE WHEN upper(p_currency) = s.base THEN 1 ELSE (SELECT e.rate FROM exchange_rates e WHERE e.base = s.base AND e.quote = upper(p_currency)) END FROM s) AS to_rate
  )
  SELECT CASE
    WHEN p.price IS NULL THEN NULL
    WHEN upper(p_currency) = p.currency THEN jsonb_build_object('amount', p.price, 'currency', p.currency, 'baseAmount', p.price, 'baseCurrency', p.currency)
    WHEN rate.from_rate IS NULL OR rate.to_rate IS NULL THEN NULL
    ELSE jsonb_build_object(
      'amount', CASE WHEN p.price = 0 THEN 0 ELSE round(public.payment_friendly_round(p.price / rate.from_rate * rate.to_rate), 2) END,
      'currency', upper(p_currency), 'baseAmount', p.price, 'baseCurrency', p.currency)
  END
  FROM p, rate
$$;

CREATE OR REPLACE FUNCTION public.payment_instance_secrets(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object('id', id, 'kind', kind, 'mode', mode, 'enabled', enabled, 'config', config, 'secrets', secrets)
    FROM admin.payment_instances WHERE id = p_id
$$;

-- ok=true resets the failure count; ok=false counts it and, at the threshold, cools the instance down.
CREATE OR REPLACE FUNCTION public.payment_instance_report(p_id uuid, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE s admin.payment_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM admin.payment_settings WHERE id = 1;
  IF p_ok THEN
    UPDATE admin.payment_instances SET consecutive_failures = 0, cooldown_until = NULL, last_ok_at = now() WHERE id = p_id;
  ELSE
    UPDATE admin.payment_instances
       SET consecutive_failures = consecutive_failures + 1,
           last_error_at = now(), last_error = left(p_error, 300),
           cooldown_until = CASE WHEN consecutive_failures + 1 >= coalesce(s.failure_threshold, 3)
                                 THEN now() + make_interval(mins => coalesce(s.cooldown_minutes, 10)) ELSE cooldown_until END
     WHERE id = p_id;
  END IF;
END $$;

-- What the app needs to decide how this account pays: off | test | live.
CREATE OR REPLACE FUNCTION public.payment_checkout_settings(p_account uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'mode', CASE
      WHEN s.collect_payments = 'live' THEN 'live'
      WHEN s.collect_payments = 'test' AND s.test_account_ids ? p_account::text THEN 'test'
      ELSE 'off' END,
    'graceDays', s.grace_days, 'reminderDays', s.reminder_days, 'transferExpiryDays', s.transfer_expiry_days)
    FROM admin.payment_settings s WHERE s.id = 1
$$;

-- ------------------------------------------------------------
-- Settlement: the ONE place a successful payment turns into a plan. Used by the app's webhook /
-- return page and by the admin console (manual bank transfer confirmation). Idempotent: the
-- (provider, provider_reference) unique index means a replayed webhook records nothing new.
-- Returns {status: 'settled' | 'duplicate' | 'not_found', accountId, planId, periodEnd}.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_period_end(p_account uuid, p_plan text, p_interval text)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT greatest(now(), CASE WHEN s.plan_id = p_plan AND s.status IN ('active', 'trialing') THEN coalesce(s.current_period_end, now()) ELSE now() END)
         + CASE p_interval WHEN 'quarterly' THEN interval '3 months' WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END
    FROM (SELECT p_account AS a) x LEFT JOIN account_subscriptions s ON s.account_id = x.a
$$;

CREATE OR REPLACE FUNCTION public.payment_settle(
  p_session uuid, p_provider_reference text, p_amount numeric, p_currency text,
  p_customer_id text DEFAULT NULL, p_subscription_id text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  cs checkout_sessions%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_provider text;
BEGIN
  SELECT * INTO cs FROM checkout_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  v_provider := coalesce(cs.provider, 'manual_transfer');
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE provider = v_provider AND provider_reference = p_provider_reference) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'accountId', cs.account_id, 'planId', cs.plan_id);
  END IF;
  v_start := greatest(now(), coalesce((SELECT current_period_end FROM account_subscriptions WHERE account_id = cs.account_id AND plan_id = cs.plan_id AND status IN ('active', 'trialing') AND current_period_end > now()), now()));
  v_end := public.payment_period_end(cs.account_id, cs.plan_id, cs.billing_interval);
  INSERT INTO subscription_payments (account_id, plan_id, amount, currency, status, billing_interval, provider, provider_reference,
                                     description, period_start, period_end, payment_instance_id, checkout_session_id)
  VALUES (cs.account_id, cs.plan_id, coalesce(p_amount, cs.amount), coalesce(upper(p_currency), cs.currency), 'succeeded', cs.billing_interval,
          v_provider, p_provider_reference, 'Checkout ' || cs.reference, v_start, v_end, cs.instance_id, cs.id);
  INSERT INTO account_subscriptions (account_id, plan_id, status, billing_interval, current_period_end, provider,
                                     provider_customer_id, provider_subscription_id, payment_instance_id, auto_renew, renewal_reminded_at, provider_meta)
  VALUES (cs.account_id, cs.plan_id, 'active', cs.billing_interval, v_end, v_provider, p_customer_id, p_subscription_id, cs.instance_id,
          cs.method = 'subscription', NULL, coalesce(p_meta, '{}'::jsonb))
  ON CONFLICT (account_id) DO UPDATE SET
    plan_id = excluded.plan_id, status = 'active', billing_interval = excluded.billing_interval, current_period_end = excluded.current_period_end,
    provider = excluded.provider, payment_instance_id = excluded.payment_instance_id, auto_renew = excluded.auto_renew, renewal_reminded_at = NULL,
    provider_customer_id = coalesce(excluded.provider_customer_id, account_subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, account_subscriptions.provider_subscription_id),
    provider_meta = account_subscriptions.provider_meta || excluded.provider_meta;
  UPDATE checkout_sessions SET status = 'succeeded', completed_at = now() WHERE id = cs.id;
  RETURN jsonb_build_object('status', 'settled', 'accountId', cs.account_id, 'planId', cs.plan_id, 'periodEnd', v_end);
END $$;

-- A provider renewal (e.g. Paystack charging the saved card for the next period). Finds the
-- subscription by instance + provider subscription or customer id. Idempotent like payment_settle.
CREATE OR REPLACE FUNCTION public.payment_renew(
  p_instance uuid, p_provider text, p_provider_reference text, p_amount numeric, p_currency text,
  p_subscription_id text DEFAULT NULL, p_customer_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  s account_subscriptions%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM account_subscriptions
   WHERE payment_instance_id = p_instance
     AND ((p_subscription_id IS NOT NULL AND provider_subscription_id = p_subscription_id)
          OR (p_subscription_id IS NULL AND p_customer_id IS NOT NULL AND provider_customer_id = p_customer_id))
   ORDER BY current_period_end DESC NULLS LAST LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE provider = p_provider AND provider_reference = p_provider_reference) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'accountId', s.account_id);
  END IF;
  v_start := greatest(now(), coalesce(s.current_period_end, now()));
  v_end := v_start + CASE s.billing_interval WHEN 'quarterly' THEN interval '3 months' WHEN 'annual' THEN interval '1 year' ELSE interval '1 month' END;
  INSERT INTO subscription_payments (account_id, plan_id, amount, currency, status, billing_interval, provider, provider_reference, description, period_start, period_end, payment_instance_id)
  VALUES (s.account_id, s.plan_id, p_amount, upper(p_currency), 'succeeded', s.billing_interval, p_provider, p_provider_reference, 'Automatic renewal', v_start, v_end, p_instance);
  UPDATE account_subscriptions SET status = 'active', current_period_end = v_end, renewal_reminded_at = NULL,
         provider_subscription_id = coalesce(p_subscription_id, provider_subscription_id)
   WHERE account_id = s.account_id;
  RETURN jsonb_build_object('status', 'settled', 'accountId', s.account_id, 'planId', s.plan_id, 'periodEnd', v_end);
END $$;

-- Provider says a subscription renewal failed or the subscription was cancelled: stop auto-renew.
-- The plan stays until current_period_end (+ grace); the billing sweep then marks it past_due.
CREATE OR REPLACE FUNCTION public.payment_subscription_stopped(p_instance uuid, p_subscription_id text, p_failed boolean)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public, admin
AS $$
  UPDATE account_subscriptions
     SET auto_renew = false,
         provider_meta = provider_meta || jsonb_build_object(CASE WHEN p_failed THEN 'renewalFailedAt' ELSE 'canceledAt' END, now())
   WHERE payment_instance_id = p_instance AND provider_subscription_id = p_subscription_id
  RETURNING jsonb_build_object('status', 'updated', 'accountId', account_id)
$$;

-- Daily bookkeeping (called by the app's billing-sweep cron): expire stale checkouts, move
-- subscriptions past their period end + grace to past_due. Returns counts.
CREATE OR REPLACE FUNCTION public.payment_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  s admin.payment_settings%ROWTYPE;
  n_expired int;
  n_past_due int;
BEGIN
  SELECT * INTO s FROM admin.payment_settings WHERE id = 1;
  UPDATE checkout_sessions SET status = 'expired', completed_at = now()
   WHERE status IN ('pending', 'redirected', 'awaiting_transfer') AND expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS n_expired = ROW_COUNT;
  UPDATE account_subscriptions SET status = 'past_due'
   WHERE status = 'active' AND plan_id <> 'free' AND current_period_end IS NOT NULL
     AND current_period_end + make_interval(days => coalesce(s.grace_days, 3)) < now();
  GET DIAGNOSTICS n_past_due = ROW_COUNT;
  RETURN jsonb_build_object('expired', n_expired, 'pastDue', n_past_due);
END $$;

REVOKE ALL ON FUNCTION public.payment_route(text, text, text, text), public.payment_quote(text, text, text),
  public.payment_instance_secrets(uuid), public.payment_instance_report(uuid, boolean, text),
  public.payment_checkout_settings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_route(text, text, text, text), public.payment_quote(text, text, text),
  public.payment_checkout_settings(uuid) TO service_role, ogadesk_admin_api;
GRANT EXECUTE ON FUNCTION public.payment_instance_secrets(uuid), public.payment_instance_report(uuid, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.payment_settle(uuid, text, numeric, text, text, text, jsonb), public.payment_renew(uuid, text, text, numeric, text, text, text),
  public.payment_subscription_stopped(uuid, text, boolean), public.payment_sweep(), public.payment_period_end(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_settle(uuid, text, numeric, text, text, text, jsonb) TO service_role, ogadesk_admin_api;
GRANT EXECUTE ON FUNCTION public.payment_renew(uuid, text, text, numeric, text, text, text), public.payment_subscription_stopped(uuid, text, boolean),
  public.payment_sweep() TO service_role;

-- Admin API: manage instances and settings; read checkouts (no secrets there).
ALTER TABLE admin.payment_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.payment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.payment_instances, admin.payment_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.payment_instances TO ogadesk_admin_api;
GRANT SELECT, UPDATE ON admin.payment_settings TO ogadesk_admin_api;
GRANT SELECT, UPDATE ON public.checkout_sessions TO ogadesk_admin_api;
GRANT SELECT ON public.payment_provider_plans TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.payment_instances;
CREATE POLICY admin_api_all ON admin.payment_instances FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.payment_settings;
CREATE POLICY admin_api_all ON admin.payment_settings FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON public.checkout_sessions;
CREATE POLICY admin_api_all ON public.checkout_sessions FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_read ON public.payment_provider_plans;
CREATE POLICY admin_api_read ON public.payment_provider_plans FOR SELECT TO ogadesk_admin_api USING (true);
