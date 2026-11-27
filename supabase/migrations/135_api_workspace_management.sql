-- ============================================================
-- 135_api_workspace_management.sql — workspace management for API keys / MCP
--
-- The dashboard's member functions (set_member_role, remove_account_member, create_workspace) authorise through
-- auth.uid(), which an API key does not have. These service-role-only twins take the workspace and the person
-- acting (the key's creator) explicitly and apply the same rules:
--   * api_set_member_role(account, actor, user, role): actor admin+, not self, never to/from owner
--   * api_remove_member(account, actor, user): actor admin+, not self, never the owner; the person keeps (or gets)
--     a workspace of their own, and their conversations are unassigned
--   * api_create_workspace(user, name): the per-plan workspaces limit applies ('plan_limit:workspaces:<n>'); the
--     person becomes owner WITHOUT switching their active workspace (an API call must not move them in the app)
-- The routes call these only after checking the key's scopes. Idempotent.
-- ============================================================
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public._api_assert_admin(p_account uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM account_members WHERE account_id = p_account AND user_id = p_actor AND account_role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'The person who created this API key must be an admin of this workspace' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._api_assert_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.api_set_member_role(p_account uuid, p_actor uuid, p_user uuid, p_role account_role_enum)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target account_role_enum;
BEGIN
  PERFORM 1 FROM account_members WHERE account_id = p_account AND user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public._api_assert_admin(p_account, p_actor);
  IF p_user = p_actor THEN
    RAISE EXCEPTION 'Cannot change your own role' USING ERRCODE = '22023';
  END IF;
  SELECT account_role INTO v_target FROM account_members WHERE account_id = p_account AND user_id = p_user;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Not a member of this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_target = 'owner' OR p_role = 'owner' THEN
    RAISE EXCEPTION 'Ownership can only be transferred in the app' USING ERRCODE = '22023';
  END IF;
  UPDATE account_members SET account_role = p_role WHERE account_id = p_account AND user_id = p_user;
END $$;
REVOKE ALL ON FUNCTION public.api_set_member_role(uuid, uuid, uuid, account_role_enum) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_set_member_role(uuid, uuid, uuid, account_role_enum) TO service_role;

CREATE OR REPLACE FUNCTION public.api_remove_member(p_account uuid, p_actor uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_target account_role_enum;
BEGIN
  PERFORM 1 FROM account_members WHERE account_id = p_account AND user_id IN (p_actor, p_user) ORDER BY user_id FOR UPDATE;
  PERFORM public._api_assert_admin(p_account, p_actor);
  IF p_user = p_actor THEN
    RAISE EXCEPTION 'Cannot remove yourself' USING ERRCODE = '22023';
  END IF;
  SELECT account_role INTO v_target FROM account_members WHERE account_id = p_account AND user_id = p_user;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Not a member of this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_target = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the workspace owner' USING ERRCODE = '22023';
  END IF;
  DELETE FROM account_members WHERE account_id = p_account AND user_id = p_user;
  UPDATE conversations SET assigned_agent_id = NULL WHERE account_id = p_account AND assigned_agent_id = p_user;
  PERFORM public.ensure_personal_workspace(p_user);
END $$;
REVOKE ALL ON FUNCTION public.api_remove_member(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_remove_member(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.api_create_workspace(p_user uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(p_name), '');
  v_id uuid;
  v_allow jsonb;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'Unknown user' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Workspace name must be 1-80 characters' USING ERRCODE = '22023';
  END IF;
  -- Same lock and limit as create_workspace (129).
  PERFORM pg_advisory_xact_lock(hashtext('create_workspace:' || p_user::text));
  v_allow := public.owned_workspace_allowance(p_user);
  IF (v_allow ->> 'allowed') IS NOT NULL AND (v_allow ->> 'owned')::int >= (v_allow ->> 'allowed')::int THEN
    RAISE EXCEPTION 'plan_limit:workspaces:%', (v_allow ->> 'allowed') USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO accounts (name, owner_user_id, onboarded_at) VALUES (v_name, p_user, now()) RETURNING id INTO v_id;
  INSERT INTO account_members (account_id, user_id, account_role) VALUES (v_id, p_user, 'owner')
    ON CONFLICT DO NOTHING;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.api_create_workspace(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_create_workspace(uuid, text) TO service_role;
