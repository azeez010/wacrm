-- 082_partner_clicks.sql - count visits on a partner's referral link.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS clicks bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION partner_click(p_code text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE partners SET clicks = clicks + 1 WHERE code = upper(p_code) AND status = 'active';
$$;
REVOKE ALL ON FUNCTION partner_click(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION partner_click(text) TO service_role;
