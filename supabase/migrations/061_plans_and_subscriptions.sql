-- ============================================================
-- 061_plans_and_subscriptions.sql — data-driven plan tiers.
--
-- `plans` is reference data (not tenant-scoped): limits and feature
-- flags are JSONB so a tier changes with a row edit / seed re-run,
-- not a deploy. Seed with `npm run seed:plans`. Unknown keys are
-- ignored by the app, so new limits need no migration.
--   limits:   { "contacts": 1000, "seats": 3, "ai_replies_per_month": null }  null = unlimited
--   features: { "flows": true, "public_api": false }
--
-- `account_subscriptions` is SELECT-only for members (writes go
-- through the service role) — plan columns on `accounts` would be
-- self-service upgradable via its owner-update policy.
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'NGN',
  price_monthly NUMERIC(14, 2) NOT NULL DEFAULT 0,
  price_quarterly NUMERIC(14, 2) NOT NULL DEFAULT 0,
  price_annual NUMERIC(14, 2) NOT NULL DEFAULT 0,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
-- Public pricing: the landing page reads active plans anonymously.
DROP POLICY IF EXISTS plans_public_select ON plans;
CREATE POLICY plans_public_select ON plans
  FOR SELECT TO anon, authenticated USING (is_active);

DROP TRIGGER IF EXISTS set_updated_at ON plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bare 'free' row so the FK below and signup work before the seed
-- script runs; the script upserts the real limits over it.
INSERT INTO plans (id, name, sort_order, limits)
VALUES ('free', 'Free', 0, '{"whatsapp_connections":1,"seats":2,"contacts":250}')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_subscriptions (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled')),
  billing_interval TEXT CHECK (billing_interval IN ('monthly', 'quarterly', 'annual')),
  current_period_end TIMESTAMPTZ,
  provider TEXT CHECK (provider IN ('paystack', 'stripe')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  -- Per-account exceptions, same shape as plans.limits / plans.features.
  limit_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  feature_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP TRIGGER IF EXISTS set_updated_at ON account_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION create_default_subscription() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO account_subscriptions (account_id) VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS accounts_default_subscription ON accounts;
CREATE TRIGGER accounts_default_subscription AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription();

INSERT INTO account_subscriptions (account_id)
SELECT id FROM accounts
ON CONFLICT (account_id) DO NOTHING;

-- ------------------------------------------------------------
-- account_limit(account, key): effective numeric limit, NULL =
-- unlimited. override > plan; canceled/past_due falls back to free.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION account_limit(target_account_id UUID, limit_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sub account_subscriptions%ROWTYPE;
  eff_plan TEXT;
  raw JSONB;
BEGIN
  SELECT * INTO sub FROM account_subscriptions WHERE account_id = target_account_id;
  eff_plan := CASE WHEN sub.account_id IS NULL OR sub.status IN ('canceled','past_due')
                   THEN 'free' ELSE sub.plan_id END;
  IF sub.account_id IS NOT NULL AND sub.limit_overrides ? limit_key THEN
    raw := sub.limit_overrides -> limit_key;
  ELSE
    SELECT limits -> limit_key INTO raw FROM plans WHERE id = eff_plan;
  END IF;
  IF raw IS NULL OR jsonb_typeof(raw) = 'null' THEN RETURN NULL; END IF;
  RETURN (raw #>> '{}')::INTEGER;
END $$;
GRANT EXECUTE ON FUNCTION account_limit(UUID, TEXT) TO authenticated, service_role;

-- Hard enforcement for contacts: they're inserted from many places
-- (UI, CSV import, public API, webhook), so the trigger is the one
-- choke point. Service-role inserts (webhook auto-create) bypass
-- nothing — the limit applies equally.
CREATE OR REPLACE FUNCTION enforce_contact_limit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lim INTEGER;
  cnt BIGINT;
BEGIN
  lim := account_limit(NEW.account_id, 'contacts');
  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO cnt FROM contacts WHERE account_id = NEW.account_id;
  IF cnt >= lim THEN
    RAISE EXCEPTION 'plan_limit:contacts:% — contact limit reached for your plan', lim
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contacts_enforce_limit ON contacts;
CREATE TRIGGER contacts_enforce_limit BEFORE INSERT ON contacts
  FOR EACH ROW EXECUTE FUNCTION enforce_contact_limit();
