-- ============================================================
-- 126_coupons_and_fees.sql — coupons, and who pays the payment-provider fee
--
--   * public.coupons / public.coupon_redemptions   (admin-managed; the app only reaches them
--     through SECURITY DEFINER functions, never directly)
--   * public.coupon_apply(...)                     single source of truth for "is this code valid and
--     how much does it take off"; service role only, so codes cannot be guessed through PostgREST
--   * public.payment_instance_public(id)           an instance's non-secret config (fee settings live there)
--   * checkout_sessions + subscription_payments get the price breakdown: list_amount, discount_amount,
--     fee_amount, fee_payer, coupon_id, net_amount (what the business receives; revenue and partner
--     commission read it), amount_expected (set when the provider reported a different amount)
--   * payment_settle / payment_renew record the breakdown and redeem the coupon
-- Existing rows keep net_amount NULL; readers use coalesce(net_amount, amount). Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  name             text,
  percent_off      numeric(5,2) CHECK (percent_off > 0 AND percent_off <= 100),
  amount_off       numeric(14,2) CHECK (amount_off > 0),   -- in the platform base currency, converted at checkout
  duration         text NOT NULL DEFAULT 'once' CHECK (duration IN ('once', 'forever')),
  plan_ids         text[],                                  -- NULL / empty = every paid plan
  intervals        text[],                                  -- NULL / empty = every billing interval
  max_redemptions  integer CHECK (max_redemptions > 0),
  max_per_account  integer NOT NULL DEFAULT 1 CHECK (max_per_account > 0),
  starts_at        timestamptz,
  ends_at          timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_one_discount CHECK (num_nonnulls(percent_off, amount_off) = 1),
  CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_key ON public.coupons (code);

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id           uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  checkout_session_id uuid REFERENCES public.checkout_sessions(id) ON DELETE SET NULL,
  payment_id          uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  discount_amount     numeric(14,2) NOT NULL DEFAULT 0,
  currency            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, checkout_session_id)
);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON public.coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_account_idx ON public.coupon_redemptions (account_id);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupons, public.coupon_redemptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.coupons TO ogadesk_admin_api;
GRANT SELECT ON public.coupon_redemptions TO ogadesk_admin_api;
GRANT ALL ON public.coupons, public.coupon_redemptions TO service_role;
DROP POLICY IF EXISTS admin_api_all ON public.coupons;
CREATE POLICY admin_api_all ON public.coupons FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_read ON public.coupon_redemptions;
CREATE POLICY admin_api_read ON public.coupon_redemptions FOR SELECT TO ogadesk_admin_api USING (true);

-- ---- price breakdown on sessions and payments --------------------------------
ALTER TABLE public.checkout_sessions
  ADD COLUMN IF NOT EXISTS coupon_id       uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_amount     numeric(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_payer       text CHECK (fee_payer IN ('customer', 'business'));
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS coupon_id       uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_amount     numeric(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_payer       text CHECK (fee_payer IN ('customer', 'business')),
  ADD COLUMN IF NOT EXISTS net_amount      numeric(14,2),
  ADD COLUMN IF NOT EXISTS amount_expected numeric(14,2);

-- ---- instance settings the app may read (config is non-secret by design) --------
CREATE OR REPLACE FUNCTION public.payment_instance_public(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT jsonb_build_object('id', id, 'kind', kind, 'mode', mode, 'config', coalesce(config, '{}'::jsonb)) FROM admin.payment_instances WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.payment_instance_public(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_instance_public(uuid) TO service_role, ogadesk_admin_api;

-- ---- coupon_apply -----------------------------------------------------------------
-- Returns {ok, reason, couponId, code, duration, discount}. Reasons: not_found, inactive, not_started, expired,
-- not_for_plan, not_for_interval, exhausted, already_used, no_rate. "discount" is in p_currency, never above p_subtotal.
CREATE OR REPLACE FUNCTION public.coupon_apply(p_code text, p_account uuid, p_plan text, p_interval text, p_subtotal numeric, p_currency text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  c coupons%ROWTYPE;
  v_base text;
  v_rate numeric;
  v_discount numeric;
BEGIN
  SELECT * INTO c FROM coupons WHERE code = upper(btrim(coalesce(p_code, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT c.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'inactive'); END IF;
  IF c.starts_at IS NOT NULL AND c.starts_at > now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_started'); END IF;
  IF c.ends_at IS NOT NULL AND c.ends_at <= now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF coalesce(array_length(c.plan_ids, 1), 0) > 0 AND NOT (p_plan = ANY (c.plan_ids)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_for_plan'); END IF;
  IF coalesce(array_length(c.intervals, 1), 0) > 0 AND NOT (p_interval = ANY (c.intervals)) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_for_interval'); END IF;
  IF c.max_redemptions IS NOT NULL AND (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = c.id) >= c.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exhausted');
  END IF;
  IF (SELECT count(*) FROM coupon_redemptions WHERE coupon_id = c.id AND account_id = p_account) >= c.max_per_account THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_used');
  END IF;

  IF c.percent_off IS NOT NULL THEN
    v_discount := round(p_subtotal * c.percent_off / 100, 2);
  ELSE
    SELECT coalesce((SELECT base_currency FROM currency_settings WHERE id = 1), 'NGN') INTO v_base;
    IF upper(p_currency) = v_base THEN
      v_discount := c.amount_off;
    ELSE
      SELECT e.rate INTO v_rate FROM exchange_rates e WHERE e.base = v_base AND e.quote = upper(p_currency);
      IF v_rate IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_rate'); END IF;
      v_discount := round(c.amount_off * v_rate, 2);
    END IF;
  END IF;
  v_discount := greatest(0, least(v_discount, p_subtotal));
  RETURN jsonb_build_object('ok', true, 'couponId', c.id, 'code', c.code, 'duration', c.duration, 'discount', v_discount);
END $$;
REVOKE ALL ON FUNCTION public.coupon_apply(text, uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_apply(text, uuid, text, text, numeric, text) TO service_role, ogadesk_admin_api;

-- ---- settle / renew record the breakdown (definitions follow the live ones) ----------

CREATE OR REPLACE FUNCTION public.payment_settle(p_session uuid, p_provider_reference text, p_amount numeric, p_currency text, p_customer_id text DEFAULT NULL::text, p_subscription_id text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'admin'
AS $function$
DECLARE
  cs checkout_sessions%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_provider text;
  v_paid numeric;
  v_net numeric;
  v_pricing jsonb;
  v_coupon coupons%ROWTYPE;
BEGIN
  SELECT * INTO cs FROM checkout_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  v_provider := coalesce(cs.provider, 'manual_transfer');
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE provider = v_provider AND provider_reference = p_provider_reference) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'accountId', cs.account_id, 'planId', cs.plan_id);
  END IF;
  v_start := greatest(now(), coalesce((SELECT current_period_end FROM account_subscriptions WHERE account_id = cs.account_id AND plan_id = cs.plan_id AND status IN ('active', 'trialing') AND current_period_end > now()), now()));
  v_end := public.payment_period_end(cs.account_id, cs.plan_id, cs.billing_interval);
  v_paid := coalesce(p_amount, cs.amount);
  -- Revenue is what the business receives: the fee is not revenue when the customer paid it.
  v_net := v_paid - CASE WHEN cs.fee_payer = 'customer' THEN coalesce(cs.fee_amount, 0) ELSE 0 END;
  INSERT INTO subscription_payments (account_id, plan_id, amount, currency, status, billing_interval, provider, provider_reference,
                                     description, period_start, period_end, payment_instance_id, checkout_session_id,
                                     list_amount, discount_amount, fee_amount, fee_payer, coupon_id, net_amount, amount_expected)
  VALUES (cs.account_id, cs.plan_id, v_paid, coalesce(upper(p_currency), cs.currency), 'succeeded', cs.billing_interval,
          v_provider, p_provider_reference, 'Checkout ' || cs.reference, v_start, v_end, cs.instance_id, cs.id,
          cs.list_amount, coalesce(cs.discount_amount, 0), coalesce(cs.fee_amount, 0), cs.fee_payer, cs.coupon_id, v_net,
          CASE WHEN cs.amount IS NOT NULL AND p_amount IS NOT NULL AND abs(p_amount - cs.amount) > 0.01 THEN cs.amount END);
  IF cs.coupon_id IS NOT NULL THEN
    SELECT * INTO v_coupon FROM coupons WHERE id = cs.coupon_id;
    INSERT INTO coupon_redemptions (coupon_id, account_id, checkout_session_id, payment_id, discount_amount, currency)
    SELECT cs.coupon_id, cs.account_id, cs.id, sp.id, coalesce(cs.discount_amount, 0), cs.currency
      FROM subscription_payments sp WHERE sp.provider = v_provider AND sp.provider_reference = p_provider_reference
    ON CONFLICT (coupon_id, checkout_session_id) DO NOTHING;
  END IF;
  -- What a later automatic renewal should record (payment_renew): the same list price and fee, and the
  -- discount only for coupons that last ("forever").
  v_pricing := jsonb_build_object('pricing', jsonb_build_object(
    'list_amount', cs.list_amount, 'fee_amount', coalesce(cs.fee_amount, 0), 'fee_payer', cs.fee_payer,
    'coupon_id', CASE WHEN v_coupon.duration = 'forever' THEN cs.coupon_id END,
    'discount_amount', CASE WHEN v_coupon.duration = 'forever' THEN coalesce(cs.discount_amount, 0) ELSE 0 END));
  INSERT INTO account_subscriptions (account_id, plan_id, status, billing_interval, current_period_end, provider,
                                     provider_customer_id, provider_subscription_id, payment_instance_id, auto_renew, renewal_reminded_at, provider_meta)
  VALUES (cs.account_id, cs.plan_id, 'active', cs.billing_interval, v_end, v_provider, p_customer_id, p_subscription_id, cs.instance_id,
          cs.method = 'subscription', NULL, coalesce(p_meta, '{}'::jsonb) || v_pricing)
  ON CONFLICT (account_id) DO UPDATE SET
    plan_id = excluded.plan_id, status = 'active', billing_interval = excluded.billing_interval, current_period_end = excluded.current_period_end,
    provider = excluded.provider, payment_instance_id = excluded.payment_instance_id, auto_renew = excluded.auto_renew, renewal_reminded_at = NULL,
    provider_customer_id = coalesce(excluded.provider_customer_id, account_subscriptions.provider_customer_id),
    provider_subscription_id = coalesce(excluded.provider_subscription_id, account_subscriptions.provider_subscription_id),
    provider_meta = account_subscriptions.provider_meta || excluded.provider_meta;
  UPDATE checkout_sessions SET status = 'succeeded', completed_at = now() WHERE id = cs.id;
  RETURN jsonb_build_object('status', 'settled', 'accountId', cs.account_id, 'planId', cs.plan_id, 'periodEnd', v_end);
END $function$;

CREATE OR REPLACE FUNCTION public.payment_renew(p_instance uuid, p_provider text, p_provider_reference text, p_amount numeric, p_currency text, p_subscription_id text DEFAULT NULL::text, p_customer_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'admin'
AS $function$
DECLARE
  s account_subscriptions%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_pr jsonb;
  v_fee numeric;
  v_payer text;
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
  v_pr := coalesce(s.provider_meta -> 'pricing', '{}'::jsonb);
  v_payer := v_pr ->> 'fee_payer';
  v_fee := coalesce((v_pr ->> 'fee_amount')::numeric, 0);
  INSERT INTO subscription_payments (account_id, plan_id, amount, currency, status, billing_interval, provider, provider_reference, description, period_start, period_end, payment_instance_id,
                                     list_amount, discount_amount, fee_amount, fee_payer, coupon_id, net_amount)
  VALUES (s.account_id, s.plan_id, p_amount, upper(p_currency), 'succeeded', s.billing_interval, p_provider, p_provider_reference, 'Automatic renewal', v_start, v_end, p_instance,
          (v_pr ->> 'list_amount')::numeric, coalesce((v_pr ->> 'discount_amount')::numeric, 0), v_fee, v_payer,
          nullif(v_pr ->> 'coupon_id', '')::uuid,
          p_amount - CASE WHEN v_payer = 'customer' THEN v_fee ELSE 0 END);
  UPDATE account_subscriptions SET status = 'active', current_period_end = v_end, renewal_reminded_at = NULL,
         provider_subscription_id = coalesce(p_subscription_id, provider_subscription_id)
   WHERE account_id = s.account_id;
  RETURN jsonb_build_object('status', 'settled', 'accountId', s.account_id, 'planId', s.plan_id, 'periodEnd', v_end);
END $function$;
