-- ============================================================
-- 134_plan_archive_contacts.sql — contacts join the plan archive (see 132)
--
-- A lower plan archives the contacts over its limit, keeping unblocked contacts and the most recent conversations.
-- An archived contact is NOT hidden or deleted: conversations, deals and inbound messages keep working and the team
-- can still reply by hand. It is left out of broadcasts, automations, chatbot flows and AI replies (the app checks
-- plan_archived_at next to blocked_at) and no longer counts toward the contacts limit. An upgrade restores them.
--
--   * contacts.plan_archived_at / plan_archived_prev
--   * _plan_archive_resources() gains the contacts row (enforce, preview and summary pick it up)
--   * enforce_contact_limit() counts only contacts the plan has not archived
--   * fix (132): resources with nothing extra to set (quick replies, contacts) failed to archive with "multiple
--     assignments to same column"; their extra SET is now empty and enforce_plan_limits skips it
-- Idempotent.
-- ============================================================
SET lock_timeout = '5s';

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
CREATE INDEX IF NOT EXISTS contacts_plan_archived_idx ON public.contacts (account_id) WHERE plan_archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public._plan_archive_resources()
RETURNS SETOF public.plan_archive_resource
LANGUAGE sql IMMUTABLE
AS $$
  SELECT v::public.plan_archive_resource FROM (VALUES
    ('forms_max', 'forms', 'forms_max', 'forms',
     't.archived_at IS NULL', 't.status = ''active''',
     'greatest(t.updated_at, (SELECT max(s.created_at) FROM public.form_submissions s WHERE s.form_id = t.id))',
     't.name', 'NULL', 'archived_at = now()', 'archived_at = NULL'),
    ('custom_fields_max', 'custom_fields', 'custom_fields_max', 'custom fields',
     't.table_id IS NULL AND t.archived_at IS NULL', 'true', 't.created_at',
     't.field_name', 'NULL', 'archived_at = now()', 'archived_at = NULL'),
    ('custom_tables_max', 'custom_tables', 'custom_tables_max', 'custom tables',
     't.archived_at IS NULL', 'true',
     'greatest(t.created_at, (SELECT max(r.updated_at) FROM public.custom_records r WHERE r.table_id = t.id))',
     't.name', 'NULL', 'archived_at = now()', 'archived_at = NULL'),
    ('automations', 'automations', 'automations', 'automations',
     't.system_key IS NULL', 't.is_active',
     'greatest(t.updated_at, (SELECT max(l.created_at) FROM public.automation_logs l WHERE l.automation_id = t.id))',
     't.name', 'is_active::text', 'is_active = false', 'is_active = coalesce(plan_archived_prev = ''true'', false)'),
    ('flows', 'flows', 'flows', 'chatbot flows',
     'true', 't.status = ''active''',
     'greatest(t.updated_at, (SELECT max(r.last_advanced_at) FROM public.flow_runs r WHERE r.flow_id = t.id))',
     't.name', 'status', 'status = ''archived''', 'status = coalesce(plan_archived_prev, ''draft'')'),
    ('webhook_endpoints', 'webhook_endpoints', 'webhook_endpoints', 'webhooks',
     'true', 't.is_active', 'coalesce(t.last_delivery_at, t.created_at)',
     't.url', 'is_active::text', 'is_active = false', 'is_active = coalesce(plan_archived_prev = ''true'', false)'),
    ('integrations_max', 'integrations', 'integrations_max', 'integrations',
     'true', 't.status = ''connected''', 't.updated_at',
     't.name', 'status', 'status = ''disabled''', 'status = coalesce(plan_archived_prev, ''disabled'')'),
    ('quick_replies', 'quick_replies', 'quick_replies', 'quick replies',
     'true', 'true', 't.updated_at',
     't.title', 'NULL', '', ''),
    -- Contacts (134): kept and still reachable from the inbox; left out of broadcasts, automations, flows and AI
    -- replies, and no longer counted. Unblocked contacts and recent conversations are kept first.
    ('contacts', 'contacts', 'contacts', 'contacts',
     'true', 't.blocked_at IS NULL',
     'greatest(t.updated_at, (SELECT max(cv.last_message_at) FROM public.conversations cv WHERE cv.contact_id = t.id))',
     'coalesce(nullif(t.name, ''''), t.phone, t.email)', 'NULL', '', '')
  ) v
$$;
REVOKE ALL ON FUNCTION public._plan_archive_resources() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_contact_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  lim INTEGER;
  cnt BIGINT;
BEGIN
  lim := account_limit(NEW.account_id, 'contacts');
  IF lim IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO cnt FROM contacts WHERE account_id = NEW.account_id AND plan_archived_at IS NULL;
  IF cnt >= lim THEN
    RAISE EXCEPTION 'plan_limit:contacts:% — contact limit reached for your plan', lim
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_plan_limits(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.plan_archive_resource;
  p record;
  lim integer;
  archived jsonb := '{}';
  restored jsonb := '{}';
  arch_text text[] := '{}';
  rest_text text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account) THEN RETURN '{}'; END IF;
  -- One run at a time per workspace.
  PERFORM pg_advisory_xact_lock(hashtext('enforce_plan_limits:' || p_account::text));
  -- Lets the guards below know this change comes from the engine, not a person.
  PERFORM set_config('ogadesk.plan_engine', 'on', true);
  FOR r IN SELECT * FROM public._plan_archive_resources() LOOP
    lim := public.account_limit(p_account, r.limit_key);
    SELECT * INTO p FROM public._plan_archive_plan(p_account, r, lim);
    IF cardinality(p.to_archive) > 0 THEN
      EXECUTE format('UPDATE public.%I SET plan_archived_prev = %s, plan_archived_at = now()%s WHERE id = ANY($1) AND account_id = $2',
                     r.tbl, r.prev_expr, CASE WHEN coalesce(r.archive_set, '') = '' THEN '' ELSE ', ' || r.archive_set END)
        USING p.to_archive, p_account;
      INSERT INTO plan_archive_log (account_id, resource, direction, row_ids, limit_value)
        VALUES (p_account, r.key, 'archive', p.to_archive, lim);
      archived := archived || jsonb_build_object(r.key, cardinality(p.to_archive));
      arch_text := arch_text || (cardinality(p.to_archive) || ' ' || r.label);
    ELSIF cardinality(p.to_restore) > 0 THEN
      EXECUTE format('UPDATE public.%I SET %splan_archived_at = NULL, plan_archived_prev = NULL WHERE id = ANY($1) AND account_id = $2',
                     r.tbl, CASE WHEN coalesce(r.restore_set, '') = '' THEN '' ELSE r.restore_set || ', ' END)
        USING p.to_restore, p_account;
      INSERT INTO plan_archive_log (account_id, resource, direction, row_ids, limit_value)
        VALUES (p_account, r.key, 'restore', p.to_restore, lim);
      restored := restored || jsonb_build_object(r.key, cardinality(p.to_restore));
      rest_text := rest_text || (cardinality(p.to_restore) || ' ' || r.label);
    END IF;
  END LOOP;
  PERFORM set_config('ogadesk.plan_engine', 'off', true);

  IF cardinality(arch_text) > 0 THEN
    INSERT INTO notifications (account_id, user_id, type, title, body)
    SELECT p_account, m.user_id, 'plan_archived', 'Some items were archived by your plan',
           'Archived: ' || array_to_string(arch_text, ', ') || '. Upgrade to bring them back.'
      FROM account_members m WHERE m.account_id = p_account AND m.account_role IN ('owner', 'admin');
  END IF;
  IF cardinality(rest_text) > 0 THEN
    INSERT INTO notifications (account_id, user_id, type, title, body)
    SELECT p_account, m.user_id, 'plan_restored', 'Archived items are back',
           'Restored: ' || array_to_string(rest_text, ', ') || '.'
      FROM account_members m WHERE m.account_id = p_account AND m.account_role IN ('owner', 'admin');
  END IF;
  RETURN jsonb_build_object('archived', archived, 'restored', restored);
END $$;
REVOKE ALL ON FUNCTION public.enforce_plan_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_plan_limits(uuid) TO service_role;
