-- ============================================================
-- 063_subscription_payments.sql — billing history (one row per
-- charge attempt / invoice). Written only by the server (payment
-- provider webhook, service role); account admins can read their
-- own history. Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, not CASCADE: payment records are financial history and must
  -- never vanish as a side effect of deleting an account (e.g. an invite
  -- redemption discarding the caller's old account) — that fails loudly instead.
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  plan_id TEXT REFERENCES plans(id),
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  billing_interval TEXT CHECK (billing_interval IN ('monthly', 'quarterly', 'annual')),
  provider TEXT CHECK (provider IN ('paystack', 'stripe', 'manual')),
  -- Provider's own reference/invoice id; unique per provider so a
  -- replayed webhook can't double-record a payment.
  provider_reference TEXT,
  description TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_provider_ref_key
  ON subscription_payments (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscription_payments_account
  ON subscription_payments (account_id, created_at DESC);

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_payments_select ON subscription_payments;
CREATE POLICY subscription_payments_select ON subscription_payments
  FOR SELECT USING (is_account_member(account_id, 'admin'));
-- No INSERT/UPDATE/DELETE policies: service role only.
