-- ============================================================
-- 116_workspaces_stage1.sql — multi-workspace, stage 1 (NO behaviour change)
--
-- Today a user belongs to exactly one account, held on profiles.account_id /
-- account_role. Stage 1 adds the structures a user-in-many-workspaces model needs
-- while profiles stays the source of truth, so every existing function, policy and
-- screen behaves exactly as before:
--   * account_members(user_id, account_id, account_role)  mirror of profiles, kept
--     in sync by a trigger (later stages make it the source of truth)
--   * profiles.active_account_id                          == account_id for now
--   * is_account_member() reads account_members           (same answers; the ~180
--     policies that call it are untouched)
--   * current_account_id()                                the helper later stages use
--   * idx_accounts_one_per_owner dropped                  (a user may own >1 workspace later)
--   * member_presence primary key (user_id, account_id)   (presence per workspace)
-- Idempotent.
-- ============================================================

-- ---- membership table ---------------------------------------
CREATE TABLE IF NOT EXISTS account_members (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  account_role account_role_enum NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_account_members_account ON account_members(account_id, account_role);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;
-- Read-only for clients: own rows, and everyone in a workspace they belong to.
-- All writes go through SECURITY DEFINER functions / the profiles sync trigger.
DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members FOR SELECT
  USING (user_id = auth.uid() OR is_account_member(account_id));
REVOKE ALL ON account_members FROM anon, authenticated;
GRANT SELECT ON account_members TO authenticated;
GRANT ALL ON account_members TO service_role;

-- Backfill: one row per existing profile.
INSERT INTO account_members (user_id, account_id, account_role)
SELECT user_id, account_id, account_role FROM profiles
ON CONFLICT (user_id, account_id) DO UPDATE SET account_role = EXCLUDED.account_role;

-- ---- keep account_members mirroring profiles ------------------
CREATE OR REPLACE FUNCTION public.sync_account_members_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM account_members WHERE user_id = OLD.user_id AND account_id = OLD.account_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM NEW.account_id THEN
    DELETE FROM account_members WHERE user_id = OLD.user_id AND account_id = OLD.account_id;
  END IF;

  INSERT INTO account_members (user_id, account_id, account_role)
  VALUES (NEW.user_id, NEW.account_id, NEW.account_role)
  ON CONFLICT (user_id, account_id) DO UPDATE SET account_role = EXCLUDED.account_role;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.sync_account_members_from_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_account_members_from_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_sync_account_members ON profiles;
CREATE TRIGGER profiles_sync_account_members
  AFTER INSERT OR UPDATE OF account_id, account_role OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_account_members_from_profile();

-- ---- active workspace pointer ---------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
UPDATE profiles SET active_account_id = account_id WHERE active_account_id IS NULL;

-- Stage 1 invariant: active_account_id follows account_id.
CREATE OR REPLACE FUNCTION public.profiles_sync_active_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.active_account_id IS NULL
     OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    NEW.active_account_id := NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.profiles_sync_active_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS profiles_sync_active_account ON profiles;
CREATE TRIGGER profiles_sync_active_account
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_sync_active_account();

-- Clients may not point themselves at another workspace directly (055 + active_account_id).
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'profiles are created by the signup trigger; they cannot be inserted directly'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.account_role IS DISTINCT FROM OLD.account_role
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.active_account_id IS DISTINCT FROM OLD.active_account_id
  THEN
    RAISE EXCEPTION
      'account_role, account_id and active_account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

-- ---- helpers ----------------------------------------------------
-- Same answers as before (account_members mirrors profiles), same signature.
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM account_members m
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
      AND CASE m.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;
ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- The caller's active workspace: the profile pointer if they still belong to it,
-- otherwise their oldest membership. NULL when they belong to none.
CREATE OR REPLACE FUNCTION public.current_account_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.active_account_id
       FROM profiles p
       JOIN account_members m ON m.user_id = p.user_id AND m.account_id = p.active_account_id
      WHERE p.user_id = auth.uid()),
    (SELECT m.account_id FROM account_members m
      WHERE m.user_id = auth.uid() ORDER BY m.created_at, m.account_id LIMIT 1)
  )
$$;
ALTER FUNCTION public.current_account_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.current_account_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account_id() TO authenticated, service_role;

-- ---- a user may own more than one workspace ---------------------
DROP INDEX IF EXISTS idx_accounts_one_per_owner;

-- ---- presence is per (user, workspace) --------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'member_presence'::regclass AND contype = 'p'
      AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE member_presence DROP CONSTRAINT member_presence_pkey;
    ALTER TABLE member_presence ADD PRIMARY KEY (user_id, account_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  v_account_id := public.current_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id, account_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now();
END;
$$;
