-- ============================================================
-- 128_admin_account_deletion.sql
-- Deleting a business from the admin console, in two steps:
--   1. "Delete" (soft): the business is suspended (its team sees a paused notice, sending and the API stop) and a row is
--      kept in admin.account_deletions. It disappears from the business list but nothing is removed, so it can be restored.
--   2. "Purge" (permanent, superadmin only): admin.purge_account() removes the business and everything that belongs to it
--      (the 53 tables that cascade from public.accounts), then removes the people who belong to no other workspace.
--      Payment records are copied into admin.deleted_account_payments first (financial history is kept, personal data is not).
-- Not removed by the purge: files in storage (listed in the result so they can be cleaned up).
-- ============================================================
CREATE TABLE IF NOT EXISTS admin.account_deletions (
  account_id   uuid PRIMARY KEY,                 -- no foreign key: the account row is gone after a purge
  account_name text NOT NULL,
  owner_email  text,
  reason       text NOT NULL,
  requested_by uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  email_sent   boolean NOT NULL DEFAULT false,
  purged_at    timestamptz,
  purge_result jsonb
);
ALTER TABLE admin.account_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.account_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.account_deletions TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.account_deletions;
CREATE POLICY admin_api_all ON admin.account_deletions FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS admin.deleted_account_payments (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL,
  payment     jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deleted_account_payments_account_idx ON admin.deleted_account_payments (account_id);
ALTER TABLE admin.deleted_account_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.deleted_account_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON admin.deleted_account_payments TO ogadesk_admin_api;
GRANT USAGE ON SEQUENCE admin.deleted_account_payments_id_seq TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_read ON admin.deleted_account_payments;
CREATE POLICY admin_api_read ON admin.deleted_account_payments FOR SELECT TO ogadesk_admin_api USING (true);

CREATE OR REPLACE FUNCTION admin.purge_account(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $$
DECLARE
  v_members uuid[];
  v_user uuid;
  v_removed int := 0;
  v_kept int := 0;
  v_payments int := 0;
  v_contacts int := 0;
  v_conversations int := 0;
BEGIN
  -- Only a business that was deleted first, and only once.
  IF NOT EXISTS (SELECT 1 FROM admin.account_deletions WHERE account_id = p_account AND purged_at IS NULL) THEN
    RAISE EXCEPTION 'account is not marked as deleted';
  END IF;

  SELECT coalesce(array_agg(user_id), '{}') INTO v_members FROM public.account_members WHERE account_id = p_account;
  SELECT count(*) INTO v_contacts FROM public.contacts WHERE account_id = p_account;
  SELECT count(*) INTO v_conversations FROM public.conversations WHERE account_id = p_account;

  INSERT INTO admin.deleted_account_payments (account_id, payment)
    SELECT p_account, to_jsonb(p) FROM public.subscription_payments p WHERE p.account_id = p_account;
  GET DIAGNOSTICS v_payments = ROW_COUNT;
  DELETE FROM public.subscription_payments WHERE account_id = p_account;

  DELETE FROM public.crm_outbox WHERE account_id = p_account;
  DELETE FROM public.accounts WHERE id = p_account;   -- cascades to every tenant table

  FOREACH v_user IN ARRAY v_members LOOP
    IF EXISTS (SELECT 1 FROM public.account_members WHERE user_id = v_user) THEN
      -- Still in another workspace: keep the person, make sure their active workspace is one that exists.
      UPDATE public.profiles SET active_account_id = (SELECT account_id FROM public.account_members WHERE user_id = v_user ORDER BY created_at LIMIT 1)
       WHERE user_id = v_user AND active_account_id IS NULL;
      v_kept := v_kept + 1;
    ELSE
      BEGIN
        DELETE FROM auth.users WHERE id = v_user;
        v_removed := v_removed + 1;
      EXCEPTION WHEN OTHERS THEN
        v_kept := v_kept + 1;  -- something still references this person; leave them rather than fail the purge
      END;
    END IF;
  END LOOP;

  UPDATE admin.account_deletions
     SET purged_at = now(),
         purge_result = jsonb_build_object('contacts', v_contacts, 'conversations', v_conversations, 'people', cardinality(v_members),
                                           'people_removed', v_removed, 'people_kept', v_kept, 'payments_archived', v_payments)
   WHERE account_id = p_account;
  RETURN (SELECT purge_result FROM admin.account_deletions WHERE account_id = p_account);
END $$;
REVOKE ALL ON FUNCTION admin.purge_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.purge_account(uuid) TO ogadesk_admin_api;
