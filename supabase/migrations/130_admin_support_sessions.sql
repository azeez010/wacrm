-- ============================================================
-- 130_admin_support_sessions.sql
-- "Open as this business" from the admin console: a time-limited support login.
--
--   1. The admin API creates admin.support_sessions (reason, read-only or not, 30 min) and gets a one-time link token
--      (valid 2 minutes, stored only as a SHA-256 hash).
--   2. The customer app's /api/support/enter claims the token (public.claim_support_session), creates a throwaway
--      auth user support-<session>@support.ogadesk.invalid (no account of its own: handle_new_user skips it), attaches it
--      to the business as an admin member with an expiry (public.attach_support_user) and signs it in.
--   3. Enforcement is in the database, not only the app:
--        - account_members.expires_at: is_account_member() and current_account_id() ignore an expired membership, so
--          every row-level-security check stops at the end of the session even if nobody cleans up.
--        - read-only sessions: a statement trigger on every public table rejects INSERT/UPDATE/DELETE by that user.
--          When changes are allowed, the same trigger records each write (table + operation) on the session.
--        - members cannot change expires_at / read_only / support_session_id themselves.
--   4. Ending (button, expiry sweep from the admin API's cron, or the app noticing expiry) deletes the throwaway user,
--      which removes its membership and profile.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin.support_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  admin_id         uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  admin_email      text NOT NULL,
  reason           text NOT NULL,
  allow_changes    boolean NOT NULL DEFAULT false,
  token_hash       text NOT NULL UNIQUE,
  token_expires_at timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  used_at          timestamptz,
  support_user_id  uuid,
  ended_at         timestamptz,
  end_reason       text
);
CREATE INDEX IF NOT EXISTS support_sessions_open_idx ON admin.support_sessions (expires_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS support_sessions_account_idx ON admin.support_sessions (account_id, created_at DESC);
ALTER TABLE admin.support_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.support_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON admin.support_sessions TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.support_sessions;
CREATE POLICY admin_api_all ON admin.support_sessions FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS admin.support_session_writes (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES admin.support_sessions(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  operation  text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_session_writes_session_idx ON admin.support_session_writes (session_id, at);
ALTER TABLE admin.support_session_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.support_session_writes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON admin.support_session_writes TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_read ON admin.support_session_writes;
CREATE POLICY admin_api_read ON admin.support_session_writes FOR SELECT TO ogadesk_admin_api USING (true);

-- Membership columns (null for every normal member).
ALTER TABLE public.account_members ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.account_members ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.account_members ADD COLUMN IF NOT EXISTS support_session_id uuid;
CREATE INDEX IF NOT EXISTS account_members_support_idx ON public.account_members (user_id) WHERE support_session_id IS NOT NULL;

-- Same as 116, plus: an expired membership counts as no membership.
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
      AND (m.expires_at IS NULL OR m.expires_at > now())
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
      WHERE p.user_id = auth.uid() AND (m.expires_at IS NULL OR m.expires_at > now())),
    (SELECT m.account_id FROM account_members m
      WHERE m.user_id = auth.uid() AND (m.expires_at IS NULL OR m.expires_at > now())
      ORDER BY m.created_at, m.account_id LIMIT 1)
  )
$$;

-- The throwaway support user gets no account of its own.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  IF NEW.email LIKE 'support-%@support.ogadesk.invalid' THEN
    RETURN NEW;  -- attach_support_user() sets up its profile and membership
  END IF;

  v_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- Members cannot grant themselves more time, lift read-only or forge a support link.
CREATE OR REPLACE FUNCTION public.protect_support_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role / server code
  IF TG_OP = 'INSERT' THEN
    IF NEW.expires_at IS NOT NULL OR NEW.read_only OR NEW.support_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'support membership fields are managed by the platform' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.read_only IS DISTINCT FROM OLD.read_only
     OR NEW.support_session_id IS DISTINCT FROM OLD.support_session_id THEN
    RAISE EXCEPTION 'support membership fields are managed by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_members_protect_support ON public.account_members;
CREATE TRIGGER account_members_protect_support BEFORE INSERT OR UPDATE ON public.account_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_support_membership();

-- Read-only guard + write log. One indexed lookup per statement, and only for signed-in callers.
CREATE OR REPLACE FUNCTION public.support_session_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  v_read_only boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT m.support_session_id, m.read_only INTO v_session, v_read_only
    FROM public.account_members m WHERE m.user_id = v_uid AND m.support_session_id IS NOT NULL LIMIT 1;
  IF v_session IS NULL THEN RETURN NULL; END IF;
  IF v_read_only THEN
    RAISE EXCEPTION 'This is a read-only support session.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO admin.support_session_writes (session_id, table_name, operation) VALUES (v_session, TG_TABLE_NAME, TG_OP);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.support_session_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND c.relname NOT IN ('member_presence')   -- the presence heartbeat would only make noise
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_support_session_guard ON public.%I', t.relname);
    EXECUTE format('CREATE TRIGGER zz_support_session_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.support_session_guard()', t.relname);
  END LOOP;
END $$;

-- Customer app (service role): claim a one-time link token. Returns the session, or nothing when the token is unknown,
-- already used or older than 2 minutes.
CREATE OR REPLACE FUNCTION public.claim_support_session(p_token_hash text)
RETURNS TABLE (id uuid, account_id uuid, admin_email text, allow_changes boolean, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
BEGIN
  RETURN QUERY
  UPDATE admin.support_sessions s SET used_at = now()
   WHERE s.token_hash = p_token_hash AND s.used_at IS NULL AND s.ended_at IS NULL
     AND s.token_expires_at > now() AND s.expires_at > now()
  RETURNING s.id, s.account_id, s.admin_email, s.allow_changes, s.expires_at;
END $$;

-- Customer app (service role): make the new throwaway user an admin member of the business until the session ends.
CREATE OR REPLACE FUNCTION public.attach_support_user(p_session uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE s admin.support_sessions;
BEGIN
  SELECT * INTO s FROM admin.support_sessions WHERE id = p_session AND ended_at IS NULL AND used_at IS NOT NULL AND support_user_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'support session is not claimable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user AND email = 'support-' || p_session || '@support.ogadesk.invalid') THEN
    RAISE EXCEPTION 'not the support user for this session';
  END IF;
  -- Defensive: if an account was bootstrapped for this user anyway, drop it.
  DELETE FROM public.accounts WHERE owner_user_id = p_user AND id <> s.account_id;
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role, active_account_id)
  VALUES (p_user, 'OgaDesk Support', 'support-' || p_session || '@support.ogadesk.invalid', s.account_id, 'admin', s.account_id)
  ON CONFLICT (user_id) DO UPDATE SET full_name = excluded.full_name, account_id = excluded.account_id, account_role = excluded.account_role, active_account_id = excluded.active_account_id;
  INSERT INTO public.account_members (user_id, account_id, account_role) VALUES (p_user, s.account_id, 'admin')
  ON CONFLICT (user_id, account_id) DO NOTHING;
  UPDATE public.account_members SET expires_at = s.expires_at, read_only = NOT s.allow_changes, support_session_id = s.id
   WHERE user_id = p_user AND account_id = s.account_id;
  UPDATE admin.support_sessions SET support_user_id = p_user WHERE id = p_session;
END $$;

-- End one session (or every expired one when p_session is null): delete the throwaway user. Returns how many ended.
CREATE OR REPLACE FUNCTION public.end_support_sessions(p_session uuid DEFAULT NULL, p_reason text DEFAULT 'expired')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id, support_user_id FROM admin.support_sessions
     WHERE ended_at IS NULL AND (CASE WHEN p_session IS NULL THEN expires_at <= now() ELSE id = p_session END)
  LOOP
    IF r.support_user_id IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = r.support_user_id;   -- cascades to membership and profile
    END IF;
    UPDATE admin.support_sessions SET ended_at = now(), end_reason = p_reason WHERE id = r.id;
    n := n + 1;
  END LOOP;
  -- Links that were never used are simply closed.
  IF p_session IS NULL THEN
    UPDATE admin.support_sessions SET ended_at = now(), end_reason = 'link not used'
     WHERE ended_at IS NULL AND used_at IS NULL AND token_expires_at <= now();
  END IF;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.claim_support_session(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_support_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_support_sessions(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_support_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_support_user(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_support_sessions(uuid, text) TO service_role, ogadesk_admin_api;
