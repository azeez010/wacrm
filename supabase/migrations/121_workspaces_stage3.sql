-- ============================================================
-- 121_workspaces_stage3.sql — multi-workspace, stage 3 (membership flows)
--
-- account_members becomes the source of truth for "who belongs where".
-- profiles.account_id / account_role now mean "the caller's ACTIVE workspace and
-- their role there" (kept in sync both ways), so every existing reader of the
-- profile keeps working.
--
--   * switch_account(account)        make another workspace you belong to active
--   * create_workspace(name)         new workspace you own (plan + Support pipeline
--                                    come from the existing account triggers)
--   * redeem_invitation              joins the workspace and KEEPS your own; no more
--                                    "your account has data / other members" refusals
--                                    (fixes invites for new users, broken since 114
--                                    gave every account a Support pipeline)
--   * remove_account_member          deletes only that membership; a person left with
--                                    no workspace gets a fresh personal one (as before)
--   * set_member_role / transfer_account_ownership   act on the caller's active
--                                    workspace via account_members
--   * admin.* member functions       read/write account_members
--   * workspace_members view         members of a workspace with their profile fields,
--                                    for the app's team lists and seat counts
--   * profiles_select                you can see profiles of people who share any
--                                    workspace with you
-- Function signatures and return values are unchanged. Idempotent.
-- ============================================================

-- ---- two-way sync between account_members and the active profile ----------
-- profile -> membership: legacy writers of profiles(account_id, account_role) keep
-- the active membership right. Never deletes (memberships are only removed explicitly).
CREATE OR REPLACE FUNCTION public.sync_account_members_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;  -- memberships cascade from auth.users
  END IF;
  INSERT INTO account_members (user_id, account_id, account_role)
  VALUES (NEW.user_id, NEW.account_id, NEW.account_role)
  ON CONFLICT (user_id, account_id) DO UPDATE
    SET account_role = EXCLUDED.account_role
    WHERE account_members.account_role IS DISTINCT FROM EXCLUDED.account_role;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.sync_account_members_from_profile() OWNER TO postgres;

-- membership -> profile: a role change or removal in the ACTIVE workspace shows
-- up on the profile. Removing the active membership points the profile at the
-- person's oldest remaining one (the caller handles "none left").
CREATE OR REPLACE FUNCTION public.sync_profile_from_account_members()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next account_members%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    UPDATE profiles SET account_role = NEW.account_role
     WHERE user_id = NEW.user_id AND account_id = NEW.account_id
       AND account_role IS DISTINCT FROM NEW.account_role;
    RETURN NEW;
  END IF;

  -- DELETE
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = OLD.user_id AND account_id = OLD.account_id) THEN
    SELECT * INTO v_next FROM account_members
     WHERE user_id = OLD.user_id AND account_id <> OLD.account_id
     ORDER BY created_at, account_id LIMIT 1;
    IF FOUND THEN
      UPDATE profiles SET account_id = v_next.account_id, account_role = v_next.account_role
       WHERE user_id = OLD.user_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION public.sync_profile_from_account_members() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_profile_from_account_members() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS account_members_sync_profile ON account_members;
CREATE TRIGGER account_members_sync_profile
  AFTER UPDATE OF account_role OR DELETE ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_from_account_members();

-- Gives a person with no workspace left a fresh personal one (same as before
-- multi-workspace) and makes it active. Returns its id.
CREATE OR REPLACE FUNCTION public.ensure_personal_workspace(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text; v_email text; v_new uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM account_members WHERE user_id = p_user) THEN
    RETURN NULL;
  END IF;
  SELECT full_name, email INTO v_name, v_email FROM profiles WHERE user_id = p_user;
  INSERT INTO accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_name, ''), v_email, 'My account'), p_user)
  RETURNING id INTO v_new;
  UPDATE profiles SET account_id = v_new, account_role = 'owner' WHERE user_id = p_user;
  -- profile -> membership trigger inserts the owner membership
  RETURN v_new;
END;
$$;
ALTER FUNCTION public.ensure_personal_workspace(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_personal_workspace(uuid) FROM PUBLIC, anon, authenticated;

-- ---- switch / create ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_account(p_account uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT account_role INTO v_role FROM account_members
   WHERE user_id = auth.uid() AND account_id = p_account;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'You are not a member of that workspace' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles SET account_id = p_account, account_role = v_role
   WHERE user_id = auth.uid();
END;
$$;
ALTER FUNCTION public.switch_account(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.switch_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_account(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(p_name), '');
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) > 80 THEN
    RAISE EXCEPTION 'Workspace name must be 1-80 characters' USING ERRCODE = '22023';
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

-- ---- invitations ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = v_caller_id) THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM account_members WHERE user_id = v_caller_id AND account_id = v_inv.account_id) THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Join, keeping every workspace the person already has, and make it active.
  INSERT INTO account_members (user_id, account_id, account_role)
  VALUES (v_caller_id, v_inv.account_id, v_inv.role);
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN v_inv.account_id;
END;
$$;
ALTER FUNCTION public.redeem_invitation(text) OWNER TO postgres;

-- ---- member management (caller's active workspace) --------------------------
CREATE OR REPLACE FUNCTION public.set_member_role(p_user_id uuid, p_new_role account_role_enum)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  v_account := public.current_account_id();
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM account_members
   WHERE account_id = v_account AND user_id IN (auth.uid(), p_user_id)
   ORDER BY user_id FOR UPDATE;
  SELECT account_role INTO v_caller_role FROM account_members
   WHERE account_id = v_account AND user_id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;
  SELECT account_role INTO v_target_role FROM account_members
   WHERE account_id = v_account AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = p_user_id) THEN
      RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;
  UPDATE account_members SET account_role = p_new_role
   WHERE account_id = v_account AND user_id = p_user_id;
END;
$$;
ALTER FUNCTION public.set_member_role(uuid, account_role_enum) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(p_new_owner_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  v_account := public.current_account_id();
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM account_members
   WHERE account_id = v_account AND user_id IN (auth.uid(), p_new_owner_user_id)
   ORDER BY user_id FOR UPDATE;
  SELECT account_role INTO v_caller_role FROM account_members
   WHERE account_id = v_account AND user_id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;
  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;
  SELECT account_role INTO v_target_role FROM account_members
   WHERE account_id = v_account AND user_id = p_new_owner_user_id;
  IF v_target_role IS NULL THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = p_new_owner_user_id) THEN
      RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  UPDATE account_members SET account_role = 'admin'
   WHERE account_id = v_account AND user_id = auth.uid();
  UPDATE account_members SET account_role = 'owner'
   WHERE account_id = v_account AND user_id = p_new_owner_user_id;
  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_account;
END;
$$;
ALTER FUNCTION public.transfer_account_ownership(uuid) OWNER TO postgres;

-- Returns the person's new personal workspace id when they had none left
-- (the old behaviour), otherwise the workspace they are now active in.
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_caller_role account_role_enum;
  v_target_role account_role_enum;
  v_result UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  v_account := public.current_account_id();
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM account_members
   WHERE account_id = v_account AND user_id IN (auth.uid(), p_user_id)
   ORDER BY user_id FOR UPDATE;
  SELECT account_role INTO v_caller_role FROM account_members
   WHERE account_id = v_account AND user_id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;
  SELECT account_role INTO v_target_role FROM account_members
   WHERE account_id = v_account AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = p_user_id) THEN
      RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM account_members WHERE account_id = v_account AND user_id = p_user_id;
  UPDATE conversations
  SET assigned_agent_id = NULL
  WHERE account_id = v_account
    AND assigned_agent_id = p_user_id;

  v_result := public.ensure_personal_workspace(p_user_id);
  IF v_result IS NULL THEN
    SELECT account_id INTO v_result FROM profiles WHERE user_id = p_user_id;
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.remove_account_member(uuid) OWNER TO postgres;

-- ---- admin console twins (same signatures and results) ----------------------
CREATE OR REPLACE FUNCTION admin.account_members(p_account uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, account_role text, created_at timestamptz, last_seen_at timestamptz, is_owner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT m.user_id, p.full_name, p.email, m.account_role::text, m.created_at, pr.last_seen_at, (m.user_id = a.owner_user_id)
    FROM account_members m
    JOIN profiles p ON p.user_id = m.user_id
    JOIN accounts a ON a.id = m.account_id
    LEFT JOIN member_presence pr ON pr.user_id = m.user_id AND pr.account_id = m.account_id
   WHERE m.account_id = p_account
   ORDER BY (m.user_id = a.owner_user_id) DESC, m.created_at
$$;

CREATE OR REPLACE FUNCTION admin.account_member_logins(p_account uuid)
RETURNS TABLE (user_id uuid, providers jsonb, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  -- providers: JSON array of strings, e.g. ["email","google"]
  SELECT u.id,
         CASE WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
              THEN u.raw_app_meta_data->'providers'
              ELSE jsonb_build_array(COALESCE(u.raw_app_meta_data->>'provider', 'email')) END,
         u.last_sign_in_at,
         u.email_confirmed_at
    FROM public.account_members m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.account_id = p_account
$$;

CREATE OR REPLACE FUNCTION admin.set_member_role(p_account uuid, p_user uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  SELECT account_role INTO v_role FROM account_members WHERE user_id = p_user AND account_id = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF v_role = 'owner' OR EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND owner_user_id = p_user) THEN RAISE EXCEPTION 'is_owner'; END IF;
  UPDATE account_members SET account_role = p_role::account_role_enum WHERE user_id = p_user AND account_id = p_account;
  RETURN jsonb_build_object('role', v_role::text);
END $$;

CREATE OR REPLACE FUNCTION admin.remove_member(p_account uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  v_role account_role_enum; v_email text; v_new uuid;
BEGIN
  SELECT account_role INTO v_role FROM account_members WHERE user_id = p_user AND account_id = p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF v_role = 'owner' OR EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND owner_user_id = p_user) THEN RAISE EXCEPTION 'is_owner'; END IF;
  SELECT email INTO v_email FROM profiles WHERE user_id = p_user;
  DELETE FROM account_members WHERE user_id = p_user AND account_id = p_account;
  UPDATE conversations SET assigned_agent_id = NULL WHERE account_id = p_account AND assigned_agent_id = p_user;
  v_new := public.ensure_personal_workspace(p_user);
  RETURN jsonb_build_object('role', v_role::text, 'email', v_email, 'newAccountId', v_new);
END $$;

-- ---- who can see whose profile -------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM account_members theirs
       WHERE theirs.user_id = profiles.user_id
         AND is_account_member(theirs.account_id)
    )
  );

-- ---- members of a workspace, with profile fields --------------------------------
-- security_invoker: the caller's own RLS on account_members + profiles applies.
CREATE OR REPLACE VIEW public.workspace_members
WITH (security_invoker = true) AS
SELECT m.account_id,
       m.user_id,
       m.account_role,
       m.created_at AS joined_at,
       p.full_name,
       p.email,
       p.avatar_url,
       p.created_at
  FROM account_members m
  JOIN profiles p ON p.user_id = m.user_id;
GRANT SELECT ON public.workspace_members TO authenticated, service_role;
