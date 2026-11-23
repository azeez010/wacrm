-- ============================================================
-- 080_partner_program.sql
--
-- Built-in partner (referral) program: every user is a partner with a
-- referral code; people who sign up through their link become `referrals`.
-- Money (commissions, payouts) is intentionally NOT here yet - it arrives
-- with payments. A separate admin site will later manage these tables with
-- the service role, so the columns below are its contract.
--
-- Writes go through the server (service role); RLS lets a user read only
-- their own partner row and referrals. Idempotent.
-- ============================================================

-- ---------------- program settings (single row) ----------------
CREATE TABLE IF NOT EXISTS partner_settings (
  id                 integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled            boolean NOT NULL DEFAULT true,
  commission_percent numeric(5,2) NOT NULL DEFAULT 20 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  recurring_months   integer NOT NULL DEFAULT 12 CHECK (recurring_months >= 0),
  hold_days          integer NOT NULL DEFAULT 14 CHECK (hold_days >= 0),
  min_payout         numeric(12,2) NOT NULL DEFAULT 50 CHECK (min_payout >= 0),
  currency           text NOT NULL DEFAULT 'USD',
  updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO partner_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------- partners: one per user ----------------
CREATE TABLE IF NOT EXISTS partners (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  display_name        text,
  show_on_leaderboard boolean NOT NULL DEFAULT false,
  payout_details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partners_code_key ON partners (code);

-- ---------------- referrals: who brought whom ----------------
CREATE TABLE IF NOT EXISTS referrals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_user_id     uuid NOT NULL REFERENCES partners(user_id) ON DELETE CASCADE,
  referred_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  code                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_referred_user_key UNIQUE (referred_user_id),
  CONSTRAINT referrals_no_self CHECK (partner_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_partner_idx ON referrals (partner_user_id, created_at DESC);

-- ---------------- marketing materials (admin-managed) ----------------
CREATE TABLE IF NOT EXISTS partner_materials (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  kind        text NOT NULL DEFAULT 'link',
  description text,
  url         text NOT NULL,
  image_url   text,
  size_label  text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------- RLS ----------------
ALTER TABLE partner_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners          ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_materials ENABLE ROW LEVEL SECURITY;

-- Never expose payout details through the client API: the app reads/writes
-- them via the service role only, so partners has no client policies at all.
REVOKE ALL ON partners FROM anon, authenticated;
REVOKE ALL ON referrals FROM anon, authenticated;
REVOKE ALL ON partner_materials FROM anon, authenticated;
REVOKE ALL ON partner_settings FROM anon, authenticated;
-- The public /partners page shows the headline commission rate.
GRANT SELECT (enabled, commission_percent, recurring_months, hold_days, min_payout, currency) ON partner_settings TO anon, authenticated;
DROP POLICY IF EXISTS partner_settings_read ON partner_settings;
CREATE POLICY partner_settings_read ON partner_settings FOR SELECT TO anon, authenticated USING (true);

-- ---------------- leaderboard ----------------
-- Opted-in, active partners ranked by referrals; names only, nothing private.
CREATE OR REPLACE FUNCTION partner_leaderboard(p_limit integer DEFAULT 20)
RETURNS TABLE (user_id uuid, display_name text, referrals bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, COALESCE(NULLIF(p.display_name, ''), p.code) AS display_name, COUNT(r.id) AS referrals
  FROM partners p
  LEFT JOIN referrals r ON r.partner_user_id = p.user_id
  WHERE p.show_on_leaderboard AND p.status = 'active'
  GROUP BY p.user_id, p.display_name, p.code
  ORDER BY COUNT(r.id) DESC, p.created_at ASC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;
REVOKE ALL ON FUNCTION partner_leaderboard(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION partner_leaderboard(integer) TO service_role;

-- ---------------- backfill: a partner row for every existing user ----------------
INSERT INTO partners (user_id, code, display_name)
SELECT
  pr.user_id,
  COALESCE(NULLIF(upper(left(regexp_replace(COALESCE(NULLIF(pr.full_name, ''), split_part(pr.email, '@', 1), ''), '[^A-Za-z0-9]', '', 'g'), 10)), ''), 'OGA')
    || upper(substr(md5(pr.user_id::text), 1, 4)),
  NULLIF(pr.full_name, '')
FROM profiles pr
JOIN auth.users u ON u.id = pr.user_id
ON CONFLICT DO NOTHING;
