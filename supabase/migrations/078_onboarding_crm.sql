-- ============================================================
-- 078_onboarding_crm
--
-- 1. Onboarding answers: how the workspace plans to use OgaDesk (multi-select),
--    where they heard about us, the referral code, and when onboarding finished.
-- 2. Per-user facts a CRM needs: language, country, marketing opt-in.
-- 3. crm_outbox: durable queue of "sync this user / track this event / send this
--    email" jobs, drained by src/lib/crm/outbox.ts (retries with backoff, no cron
--    required). Service role only. Idempotent.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS use_cases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS heard_from TEXT,
  ADD COLUMN IF NOT EXISTS heard_from_detail TEXT,
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_use_cases_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_use_cases_check
  CHECK (use_cases <@ ARRAY['developer', 'support', 'sales', 'marketing']::TEXT[]);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS crm_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('contact', 'event', 'email')),
  -- No foreign keys: a job must outlive the user/account it describes (e.g. a
  -- "removed" event), and the sync simply skips a user that no longer exists.
  user_id UUID,
  account_id UUID,
  -- Collapses duplicates: at most one *pending* job per key.
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_outbox_pending_dedupe
  ON crm_outbox (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS idx_crm_outbox_due
  ON crm_outbox (next_attempt_at)
  WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_crm_outbox_sent
  ON crm_outbox (sent_at)
  WHERE status = 'sent';

ALTER TABLE crm_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role touches this table.

-- Take up to p_limit due jobs. SKIP LOCKED lets concurrent flushers each get
-- different rows; jobs stuck in 'processing' (a crashed worker) are retaken
-- after 10 minutes. Counting the attempt here means a crash still counts.
CREATE OR REPLACE FUNCTION crm_claim_outbox(p_limit INTEGER)
RETURNS SETOF crm_outbox
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE crm_outbox o
     SET status = 'processing',
         locked_at = NOW(),
         attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT c.id
       FROM crm_outbox c
      WHERE (c.status = 'pending' AND c.next_attempt_at <= NOW())
         OR (c.status = 'processing' AND c.locked_at < NOW() - INTERVAL '10 minutes')
      ORDER BY c.next_attempt_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
$$;

REVOKE ALL ON FUNCTION crm_claim_outbox(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_claim_outbox(INTEGER) TO service_role;
