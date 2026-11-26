-- ============================================================
-- 106_admin_member_management.sql
-- Team management from the admin console. The app's own RPCs (018/019) are auth.uid()-based, so the
-- console gets SECURITY DEFINER twins that repeat the same guards:
--   admin.account_members(account)                       members: name, email, role, joined, last seen
--   admin.account_invites(account)                       invitations (never the token or its hash)
--   admin.set_member_role(account, user, role)           admin | agent | viewer; never the owner, never to owner
--   admin.remove_member(account, user)                   not the owner; the person gets a fresh personal account (like 018)
--   admin.reissue_invite(account, role, label, hash,     revoke one pending invite (optional) and create a new one.
--                        expires_at, revoke_id)          The API makes the token; only its SHA-256 is stored.
-- EXECUTE only for ogadesk_admin_api. The API audits every call. Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION admin.account_members(p_account uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, account_role text, created_at timestamptz, last_seen_at timestamptz, is_owner boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT p.user_id, p.full_name, p.email, p.account_role::text, p.created_at, pr.last_seen_at, (p.user_id = a.owner_user_id)
    FROM profiles p
    JOIN accounts a ON a.id = p.account_id
    LEFT JOIN member_presence pr ON pr.user_id = p.user_id AND pr.account_id = p.account_id
   WHERE p.account_id = p_account
   ORDER BY (p.user_id = a.owner_user_id) DESC, p.created_at
$$;

CREATE OR REPLACE FUNCTION admin.account_invites(p_account uuid)
RETURNS TABLE (id uuid, role text, label text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT i.id, i.role::text, i.label, i.created_at, i.expires_at, i.accepted_at,
         CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.expires_at <= now() THEN 'expired' ELSE 'pending' END
    FROM account_invitations i WHERE i.account_id = p_account
   ORDER BY i.created_at DESC LIMIT 50
$$;

CREATE OR REPLACE FUNCTION admin.set_member_role(p_account uuid, p_user uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  v_acc uuid;
  v_role account_role_enum;
BEGIN
  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  SELECT account_id, account_role INTO v_acc, v_role FROM profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND OR v_acc IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF v_role = 'owner' OR EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND owner_user_id = p_user) THEN RAISE EXCEPTION 'is_owner'; END IF;
  UPDATE profiles SET account_role = p_role::account_role_enum WHERE user_id = p_user;
  RETURN jsonb_build_object('role', v_role::text);
END $$;

CREATE OR REPLACE FUNCTION admin.remove_member(p_account uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  v_acc uuid; v_role account_role_enum; v_name text; v_email text; v_new uuid;
BEGIN
  SELECT account_id, account_role, full_name, email INTO v_acc, v_role, v_name, v_email FROM profiles WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND OR v_acc IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'not_a_member'; END IF;
  IF v_role = 'owner' OR EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND owner_user_id = p_user) THEN RAISE EXCEPTION 'is_owner'; END IF;
  INSERT INTO accounts (name, owner_user_id) VALUES (COALESCE(NULLIF(v_name, ''), v_email, 'My account'), p_user) RETURNING id INTO v_new;
  UPDATE profiles SET account_id = v_new, account_role = 'owner' WHERE user_id = p_user;
  RETURN jsonb_build_object('role', v_role::text, 'email', v_email, 'newAccountId', v_new);
END $$;

CREATE OR REPLACE FUNCTION admin.reissue_invite(p_account uuid, p_role text, p_label text, p_hash text, p_expires_at timestamptz, p_revoke uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_hash'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_revoke IS NOT NULL THEN
    DELETE FROM account_invitations WHERE id = p_revoke AND account_id = p_account AND accepted_at IS NULL;
  END IF;
  INSERT INTO account_invitations (account_id, token_hash, role, label, expires_at)
  VALUES (p_account, p_hash, p_role::account_role_enum, nullif(btrim(p_label), ''), p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION admin.account_members(uuid), admin.account_invites(uuid), admin.set_member_role(uuid, uuid, text),
  admin.remove_member(uuid, uuid), admin.reissue_invite(uuid, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.account_members(uuid), admin.account_invites(uuid), admin.set_member_role(uuid, uuid, text),
  admin.remove_member(uuid, uuid), admin.reissue_invite(uuid, text, text, text, timestamptz, uuid) TO ogadesk_admin_api;
