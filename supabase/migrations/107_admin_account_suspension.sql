-- ============================================================
-- 107_admin_account_suspension.sql
-- Suspend a whole business from the admin console.
--   admin.account_suspensions        one row per CURRENTLY suspended business (unsuspend = delete the row;
--                                    the history lives in the admin audit log). `reason` is internal and is
--                                    never returned to the app; `message` is what the customer sees.
--   public.account_suspension_gate   {suspended, message}. A signed-in caller only learns about their own
--                                    business; server code (service role, no auth.uid()) can ask about any.
-- The app fails OPEN on any error, so a problem with this can never lock customers out. Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin.account_suspensions (
  account_id   uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  message      text,
  suspended_by uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  suspended_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE admin.account_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.account_suspensions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.account_suspensions TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.account_suspensions;
CREATE POLICY admin_api_all ON admin.account_suspensions FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.account_suspension_gate(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
  s admin.account_suspensions%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_account_member(p_account, 'viewer') THEN
    RETURN jsonb_build_object('suspended', false, 'message', NULL);
  END IF;
  SELECT * INTO s FROM admin.account_suspensions WHERE account_id = p_account;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('suspended', false, 'message', NULL);
  END IF;
  RETURN jsonb_build_object('suspended', true, 'message', coalesce(nullif(btrim(s.message), ''),
    'This workspace has been paused. Please contact support to get it reactivated.'));
END $$;

REVOKE ALL ON FUNCTION public.account_suspension_gate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_suspension_gate(uuid) TO authenticated, service_role, ogadesk_admin_api;
