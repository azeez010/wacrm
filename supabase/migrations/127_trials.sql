-- ============================================================
-- 127_trials.sql — free trials of a paid plan, set per plan in the admin console
--
--   * plans.trial_days (0 = no trial), plans.trial_on_signup (at most one plan: given to people who sign up
--     without choosing a plan), plans.promo_quarterly / promo_annual (optional badge text for the pricing toggle)
--   * trial_grants: one trial per PERSON, not per workspace (keyed by user and by a normalised email, so
--     "a.b+x@gmail.com" cannot start a second one)
--   * grant_trial(account, user, plan): service role only; the app calls it from the first onboarding save
--   * payment_sweep(): trials past their last day go back to Free and are returned as endedTrials
--   * trials_ending(days) / trial_reminded(account): the sweep route sends "trial ending" emails once
--   * account_subscriptions.trial_ended_at; notification types for trials
-- Nothing changes until an admin sets trial_days on a plan. Idempotent.
-- ============================================================
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS trial_days        integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0 AND trial_days <= 365),
  ADD COLUMN IF NOT EXISTS trial_on_signup   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_quarterly   text CHECK (char_length(promo_quarterly) <= 40),
  ADD COLUMN IF NOT EXISTS promo_annual      text CHECK (char_length(promo_annual) <= 40);
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_trial_on_signup ON public.plans ((true)) WHERE trial_on_signup;

ALTER TABLE public.account_subscriptions ADD COLUMN IF NOT EXISTS trial_ended_at timestamptz;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['conversation_assigned'::text, 'form_submission'::text, 'trial_ending'::text, 'trial_ended'::text]));

-- lower-case, no "+tag", no dots for Gmail
CREATE OR REPLACE FUNCTION public.normalize_email(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' in p_email) = 0 THEN lower(btrim(coalesce(p_email, '')))
    ELSE
      CASE WHEN lower(split_part(btrim(p_email), '@', 2)) IN ('gmail.com', 'googlemail.com')
           THEN replace(split_part(lower(split_part(btrim(p_email), '@', 1)), '+', 1), '.', '') || '@gmail.com'
           ELSE split_part(lower(split_part(btrim(p_email), '@', 1)), '+', 1) || '@' || lower(split_part(btrim(p_email), '@', 2))
      END
  END
$$;

CREATE TABLE IF NOT EXISTS public.trial_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email_norm  text NOT NULL UNIQUE,
  account_id  uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  plan_id     text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL
);
ALTER TABLE public.trial_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.trial_grants TO ogadesk_admin_api;
GRANT ALL ON public.trial_grants TO service_role;
DROP POLICY IF EXISTS admin_api_read ON public.trial_grants;
CREATE POLICY admin_api_read ON public.trial_grants FOR SELECT TO ogadesk_admin_api USING (true);

-- {granted, reason?, planId?, days?, endsAt?}. Reasons: unknown_plan, no_trial, not_owner, not_free, already_used.
CREATE OR REPLACE FUNCTION public.grant_trial(p_account uuid, p_user uuid, p_plan text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan plans%ROWTYPE;
  v_email text;
  v_norm text;
  v_sub account_subscriptions%ROWTYPE;
  v_ends timestamptz;
BEGIN
  SELECT * INTO v_plan FROM plans WHERE id = p_plan AND is_active;
  IF NOT FOUND OR v_plan.id = 'free' THEN RETURN jsonb_build_object('granted', false, 'reason', 'unknown_plan'); END IF;
  IF v_plan.trial_days <= 0 THEN RETURN jsonb_build_object('granted', false, 'reason', 'no_trial'); END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND owner_user_id = p_user) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'not_owner');
  END IF;
  SELECT * INTO v_sub FROM account_subscriptions WHERE account_id = p_account FOR UPDATE;
  IF NOT FOUND OR v_sub.plan_id <> 'free' OR v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'not_free');
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;
  v_norm := public.normalize_email(v_email);
  IF v_norm = '' OR EXISTS (SELECT 1 FROM trial_grants WHERE user_id = p_user OR email_norm = v_norm) THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_used');
  END IF;

  v_ends := now() + make_interval(days => v_plan.trial_days);
  BEGIN
    INSERT INTO trial_grants (user_id, email_norm, account_id, plan_id, ends_at) VALUES (p_user, v_norm, p_account, p_plan, v_ends);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_used');
  END;
  UPDATE account_subscriptions
     SET plan_id = p_plan, status = 'trialing', billing_interval = NULL, current_period_end = v_ends, auto_renew = false,
         provider = NULL, payment_instance_id = NULL, renewal_reminded_at = NULL, trial_ended_at = NULL
   WHERE account_id = p_account;
  RETURN jsonb_build_object('granted', true, 'planId', p_plan, 'days', v_plan.trial_days, 'endsAt', v_ends);
END $$;
REVOKE ALL ON FUNCTION public.grant_trial(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_trial(uuid, uuid, text) TO service_role;

-- Trials that end within p_days and have not been reminded yet.
CREATE OR REPLACE FUNCTION public.trials_ending(p_days integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', account_id, 'planId', plan_id, 'endsAt', current_period_end)), '[]'::jsonb)
    FROM account_subscriptions
   WHERE status = 'trialing' AND renewal_reminded_at IS NULL
     AND current_period_end > now() AND current_period_end <= now() + make_interval(days => greatest(coalesce(p_days, 3), 1))
$$;
REVOKE ALL ON FUNCTION public.trials_ending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trials_ending(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trial_reminded(p_account uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE account_subscriptions SET renewal_reminded_at = now() WHERE account_id = p_account AND status = 'trialing'
$$;
REVOKE ALL ON FUNCTION public.trial_reminded(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trial_reminded(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.payment_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'admin'
AS $function$
DECLARE
  s admin.payment_settings%ROWTYPE;
  n_expired int;
  n_past_due int;
  v_ended jsonb;
BEGIN
  SELECT * INTO s FROM admin.payment_settings WHERE id = 1;
  UPDATE checkout_sessions SET status = 'expired', completed_at = now()
   WHERE status IN ('pending', 'redirected', 'awaiting_transfer') AND expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS n_expired = ROW_COUNT;
  UPDATE account_subscriptions SET status = 'past_due'
   WHERE status = 'active' AND plan_id <> 'free' AND current_period_end IS NOT NULL
     AND current_period_end + make_interval(days => coalesce(s.grace_days, 3)) < now();
  GET DIAGNOSTICS n_past_due = ROW_COUNT;
  -- Trials whose days are up go back to Free (their plan limits stop applying). The app emails and notifies from `endedTrials`.
  WITH due AS (
    SELECT account_id, plan_id FROM account_subscriptions
     WHERE status = 'trialing' AND current_period_end IS NOT NULL AND current_period_end < now() FOR UPDATE
  ), upd AS (
    UPDATE account_subscriptions a SET plan_id = 'free', status = 'active', billing_interval = NULL, current_period_end = NULL,
           auto_renew = false, provider = NULL, payment_instance_id = NULL, renewal_reminded_at = NULL, trial_ended_at = now()
      FROM due WHERE a.account_id = due.account_id RETURNING due.account_id, due.plan_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', account_id, 'planId', plan_id)), '[]'::jsonb) INTO v_ended FROM upd;
  RETURN jsonb_build_object('expired', n_expired, 'pastDue', n_past_due, 'endedTrials', v_ended);
END $function$;
