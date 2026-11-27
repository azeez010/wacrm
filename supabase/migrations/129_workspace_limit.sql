-- ============================================================
-- 129_workspace_limit.sql — how many workspaces a person may own, per plan
--
--   * plans.limits.workspaces: Free 1, Starter 3, Pro 10 (only added where the plan has no value yet, so
--     anything already set in the admin console is kept). Editable per plan in the admin console.
--   * public.owned_workspace_allowance(user): how many they own and the most any of their owned workspaces'
--     plans allows (a person upgrades one workspace to be allowed more; NULL = unlimited)
--   * create_workspace() refuses with 'plan_limit:workspaces:<n>' (P0001, same shape as the contacts limit) once
--     they own as many as allowed. Joining someone else's workspace never counts. People who already own more
--     keep them; they just cannot create another.
-- Idempotent.
-- ============================================================
UPDATE public.plans SET limits = limits || jsonb_build_object('workspaces', 1)  WHERE id = 'free'    AND NOT (limits ? 'workspaces');
UPDATE public.plans SET limits = limits || jsonb_build_object('workspaces', 3)  WHERE id = 'starter' AND NOT (limits ? 'workspaces');
UPDATE public.plans SET limits = limits || jsonb_build_object('workspaces', 10) WHERE id = 'pro'     AND NOT (limits ? 'workspaces');

CREATE OR REPLACE FUNCTION public.owned_workspace_allowance(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owned integer;
  v_unlimited boolean;
  v_allowed integer;
BEGIN
  SELECT count(*) INTO v_owned FROM accounts WHERE owner_user_id = p_user;
  -- account_limit: plan value, per-business override, lapsed plan -> free. NULL = unlimited.
  SELECT bool_or(public.account_limit(a.id, 'workspaces') IS NULL), max(public.account_limit(a.id, 'workspaces'))
    INTO v_unlimited, v_allowed
    FROM accounts a WHERE a.owner_user_id = p_user;
  IF v_owned = 0 THEN
    v_allowed := coalesce((SELECT (limits ->> 'workspaces')::int FROM plans WHERE id = 'free'), 1);
    v_unlimited := false;
  END IF;
  RETURN jsonb_build_object('owned', v_owned, 'allowed', CASE WHEN v_unlimited THEN NULL ELSE coalesce(v_allowed, 1) END);
END $$;
REVOKE ALL ON FUNCTION public.owned_workspace_allowance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owned_workspace_allowance(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(p_name), '');
  v_id uuid;
  v_allow jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Workspace name must be 1-80 characters' USING ERRCODE = '22023';
  END IF;
  -- One at a time per person, so two quick clicks cannot both slip under the limit.
  PERFORM pg_advisory_xact_lock(hashtext('create_workspace:' || auth.uid()::text));
  v_allow := public.owned_workspace_allowance(auth.uid());
  IF (v_allow ->> 'allowed') IS NOT NULL AND (v_allow ->> 'owned')::int >= (v_allow ->> 'allowed')::int THEN
    RAISE EXCEPTION 'plan_limit:workspaces:%', (v_allow ->> 'allowed') USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO accounts (name, owner_user_id) VALUES (v_name, auth.uid()) RETURNING id INTO v_id;
  -- Skip the first-run questions: the person already answered them once.
  UPDATE accounts SET onboarded_at = now() WHERE id = v_id;
  UPDATE profiles SET account_id = v_id, account_role = 'owner' WHERE user_id = auth.uid();
  RETURN v_id;
END;
$$;
ALTER FUNCTION public.create_workspace(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_workspace(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;
