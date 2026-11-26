-- ============================================================
-- 104_admin_partner_payouts.sql
-- Manual partner payout ledger. Commission itself is still derived (estimate) from referred
-- businesses' succeeded payments; this table records what was actually paid out, so the owed
-- balance = payable commission - paid/pending payouts, per partner and currency.
-- Bank/payout details stay out of reach: only admin.partner_payout_details(user) returns them
-- (the API audits every reveal and requires its own capability). Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin.partner_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_user_id uuid NOT NULL REFERENCES public.partners(user_id) ON DELETE RESTRICT,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  currency        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'void')),
  reference       text,
  note            text,
  created_by      uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  paid_by         uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  voided_at       timestamptz
);
CREATE INDEX IF NOT EXISTS partner_payouts_partner_idx ON admin.partner_payouts (partner_user_id, created_at DESC);
ALTER TABLE admin.partner_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.partner_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON admin.partner_payouts TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.partner_payouts;
CREATE POLICY admin_api_all ON admin.partner_payouts FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION admin.partner_payout_details(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$ SELECT coalesce(payout_details, '{}'::jsonb) FROM partners WHERE user_id = p_user $$;
REVOKE ALL ON FUNCTION admin.partner_payout_details(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.partner_payout_details(uuid) TO ogadesk_admin_api;
