-- ============================================================
-- 109_admin_auth_settings.sql
--
-- Sign-in controls for the admin console:
--  * admin.platform_settings gains
--      admin_totp_required      : platform admins must pass TOTP to sign in (default on)
--      customer_password_login  : customers may sign in / sign up with email + password
--      customer_google_login    : customers may sign in / sign up with Google
--  * public.auth_login_options()           : what the login/signup pages show (anon readable)
--  * public.custom_access_token_hook(event) : Supabase Auth hook that enforces the two
--    customer switches server-side. Enable it in the dashboard:
--    Auth > Hooks > Custom Access Token > public.custom_access_token_hook
--  * admin.account_member_logins(account)  : sign-in providers + last sign-in per member
--  * handle_new_user() also reads `name` (what Google sends) when `full_name` is empty.
-- Additive; everything stays allowed until an admin flips a switch. Idempotent.
-- ============================================================

ALTER TABLE admin.platform_settings
  ADD COLUMN IF NOT EXISTS admin_totp_required     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS admin_totp_reason       text,
  ADD COLUMN IF NOT EXISTS customer_password_login boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS customer_google_login   boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------
-- What the customer login/signup pages render. Only the two booleans,
-- never who changed them or why.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_login_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('password', customer_password_login, 'google', customer_google_login)
       FROM admin.platform_settings WHERE id = 1),
    jsonb_build_object('password', true, 'google', true))
$$;
ALTER FUNCTION public.auth_login_options() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.auth_login_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login_options() TO anon, authenticated;

-- ------------------------------------------------------------
-- Custom access token hook. Runs whenever Supabase Auth issues a token.
-- Blocks NEW sign-ins by a disabled method; token refreshes always pass so
-- people already signed in are not thrown out. Fails open on any error so a
-- settings problem can never lock every customer out.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
  v_method text := event->>'authentication_method';
  v_password boolean;
  v_google boolean;
BEGIN
  IF v_method IS NULL OR v_method = 'token_refresh' THEN
    RETURN event;
  END IF;

  SELECT customer_password_login, customer_google_login INTO v_password, v_google
    FROM admin.platform_settings WHERE id = 1;

  IF v_method = 'oauth' AND v_google IS FALSE THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Google sign-in is currently disabled.'));
  END IF;

  IF v_method IN ('password', 'email/signup', 'recovery', 'otp', 'magiclink', 'email_change')
     AND v_password IS FALSE THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Email and password sign-in is currently disabled.'));
  END IF;

  RETURN event;
EXCEPTION WHEN OTHERS THEN
  RETURN event;
END;
$$;
ALTER FUNCTION public.custom_access_token_hook(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- ------------------------------------------------------------
-- Sign-in info for the admin console's members card.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin.account_member_logins(p_account uuid)
RETURNS TABLE (user_id uuid, providers jsonb, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  -- providers: JSON array of strings, e.g. ["email","google"]
  SELECT u.id,
         CASE WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
              THEN u.raw_app_meta_data->'providers'
              ELSE jsonb_build_array(COALESCE(u.raw_app_meta_data->>'provider', 'email')) END,
         u.last_sign_in_at,
         u.email_confirmed_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
   WHERE p.account_id = p_account
$$;
ALTER FUNCTION admin.account_member_logins(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION admin.account_member_logins(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.account_member_logins(uuid) TO ogadesk_admin_api;

-- ------------------------------------------------------------
-- New-user bootstrap (same as 017) — also take Google's `name`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
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
$$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
