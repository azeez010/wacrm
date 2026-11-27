-- ============================================================
-- 132_plan_archive.sql — a lower plan archives what no longer fits; a higher plan brings it back
--
-- Rule: when the limits that apply to a workspace go down (downgrade, lapsed plan dropping to Free, a per-business
-- override, or the admin lowering a plan's limits), each archivable resource is cut back to the new limit, keeping
-- the most recently active ones (and anything switched on before anything switched off). When room comes back,
-- the items the PLAN archived are restored, newest archive first. Items a person archived themselves are never
-- touched.
--
--   resource          limit key            "archived" means                        counted rows
--   forms             forms_max            archived_at set                         not archived
--   custom fields     custom_fields_max    archived_at set (contact fields only)   not archived
--   custom tables     custom_tables_max    archived_at set                         not archived
--   automations       automations          is_active = false                       all except system ones
--   chatbot flows     flows                status = 'archived'                     all
--   webhooks          webhook_endpoints    is_active = false                       all
--   integrations      integrations_max     status = 'disabled'                     all
--   quick replies     quick_replies        hidden (row security)                   all
--
-- Rows the plan archived carry plan_archived_at (and plan_archived_prev = the state to restore) and stop counting
-- toward the limit. Switching one back on by hand is allowed only when there is room (otherwise the database
-- answers 'plan_limit:<key>:<n>', which opens the upgrade dialog in the app); doing so clears the marker.
--
-- Not archived here: contacts (separate stage), pipelines and message templates (deals and Meta-approved
-- templates hang off them), team seats, WhatsApp numbers, API keys (revoking is irreversible) and monthly
-- allowances. Over those limits a workspace simply cannot add more.
--
--   * public.enforce_plan_limits(account)        archive/restore now; logs + notifies owners and admins
--   * public.plan_archive_preview(account, plan) what switching to that plan would archive or restore
--   * public.plan_archived_summary(account)      how many of each are archived by the plan right now
--   * triggers: account_subscriptions (plan, status, overrides) and plans (limits) run the engine; a guard on
--     each table enforces the limit when a person switches a plan-archived item back on.
-- Engine errors never block a payment or a plan change (they are logged as warnings).
-- Idempotent.
-- ============================================================
SET lock_timeout = '5s';

ALTER TABLE public.forms             ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.custom_fields     ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.custom_tables     ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.automations       ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.flows             ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.webhook_endpoints ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.integrations      ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;
ALTER TABLE public.quick_replies     ADD COLUMN IF NOT EXISTS plan_archived_at timestamptz, ADD COLUMN IF NOT EXISTS plan_archived_prev text;

-- Quick replies have no "off" state of their own: archived ones are hidden from the app.
DROP POLICY IF EXISTS plan_archive_hidden ON public.quick_replies;
CREATE POLICY plan_archive_hidden ON public.quick_replies AS RESTRICTIVE FOR SELECT TO authenticated
  USING (plan_archived_at IS NULL);

-- Who changed what, for support.
CREATE TABLE IF NOT EXISTS public.plan_archive_log (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  resource text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('archive', 'restore')),
  row_ids uuid[] NOT NULL,
  limit_value integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_archive_log_account_idx ON public.plan_archive_log (account_id, created_at DESC);
ALTER TABLE public.plan_archive_log ENABLE ROW LEVEL SECURITY; -- service role only

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['conversation_assigned'::text, 'form_submission'::text, 'trial_ending'::text, 'trial_ended'::text,
                           'plan_archived'::text, 'plan_restored'::text]));

-- One row per archivable resource. Expressions use the table alias t.
DO $$ BEGIN
  IF to_regtype('public.plan_archive_resource') IS NULL THEN
    CREATE TYPE public.plan_archive_resource AS (
      key text, tbl text, limit_key text, label text,
      counted text,      -- which rows count toward the limit (besides plan_archived_at IS NULL)
      on_state text,     -- switched on: kept before switched-off rows
      recency text,      -- most recently active first
      name_expr text,
      prev_expr text,    -- state saved to plan_archived_prev before archiving
      archive_set text,  -- extra SET when archiving
      restore_set text   -- extra SET when restoring (may read plan_archived_prev)
    );
  END IF;
END $$;

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
     't.title', 'NULL', 'plan_archived_prev = NULL', 'plan_archived_prev = NULL')
  ) v
$$;
REVOKE ALL ON FUNCTION public._plan_archive_resources() FROM PUBLIC, anon, authenticated;

-- The limit a plan would give this account (its per-business override wins, as in account_limit). NULL = unlimited.
CREATE OR REPLACE FUNCTION public._plan_limit_for(p_account uuid, p_plan text, p_key text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  raw jsonb;
  ov jsonb;
BEGIN
  SELECT limit_overrides INTO ov FROM account_subscriptions WHERE account_id = p_account;
  IF ov ? p_key THEN
    raw := ov -> p_key;
  ELSE
    SELECT limits -> p_key INTO raw FROM plans WHERE id = p_plan;
  END IF;
  IF raw IS NULL OR jsonb_typeof(raw) = 'null' THEN RETURN NULL; END IF;
  RETURN (raw #>> '{}')::integer;
END $$;
REVOKE ALL ON FUNCTION public._plan_limit_for(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Ids to archive (over the limit) and to restore (room available) for one resource at a given limit.
CREATE OR REPLACE FUNCTION public._plan_archive_plan(p_account uuid, r public.plan_archive_resource, p_limit integer,
  OUT counted integer, OUT to_archive uuid[], OUT to_restore uuid[], OUT archive_names text[], OUT restore_names text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.account_id = $1 AND t.plan_archived_at IS NULL AND (%s)', r.tbl, r.counted)
    INTO counted USING p_account;
  to_archive := '{}'; to_restore := '{}'; archive_names := '{}'; restore_names := '{}';
  IF p_limit IS NOT NULL AND counted > p_limit THEN
    EXECUTE format(
      'SELECT coalesce(array_agg(id ORDER BY ord), ''{}''), coalesce(array_agg(nm ORDER BY ord), ''{}'') FROM (
         SELECT t.id, (%s)::text AS nm, row_number() OVER (ORDER BY (%s) DESC, (%s) DESC NULLS LAST, t.created_at DESC, t.id) AS ord
           FROM public.%I t WHERE t.account_id = $1 AND t.plan_archived_at IS NULL AND (%s)) x
       WHERE ord > $2',
      r.name_expr, r.on_state, r.recency, r.tbl, r.counted)
      INTO to_archive, archive_names USING p_account, p_limit;
  ELSIF p_limit IS NULL OR counted < p_limit THEN
    EXECUTE format(
      'SELECT coalesce(array_agg(id ORDER BY ord), ''{}''), coalesce(array_agg(nm ORDER BY ord), ''{}'') FROM (
         SELECT t.id, (%s)::text AS nm, row_number() OVER (ORDER BY t.plan_archived_at DESC, (%s) DESC NULLS LAST, t.id) AS ord
           FROM public.%I t WHERE t.account_id = $1 AND t.plan_archived_at IS NOT NULL) x
       WHERE $2::integer IS NULL OR ord <= $2::integer',
      r.name_expr, r.recency, r.tbl)
      INTO to_restore, restore_names USING p_account, CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit - counted END;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._plan_archive_plan(uuid, public.plan_archive_resource, integer) FROM PUBLIC, anon, authenticated;

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
      EXECUTE format('UPDATE public.%I SET plan_archived_prev = %s, plan_archived_at = now(), %s WHERE id = ANY($1) AND account_id = $2',
                     r.tbl, r.prev_expr, r.archive_set)
        USING p.to_archive, p_account;
      INSERT INTO plan_archive_log (account_id, resource, direction, row_ids, limit_value)
        VALUES (p_account, r.key, 'archive', p.to_archive, lim);
      archived := archived || jsonb_build_object(r.key, cardinality(p.to_archive));
      arch_text := arch_text || (cardinality(p.to_archive) || ' ' || r.label);
    ELSIF cardinality(p.to_restore) > 0 THEN
      EXECUTE format('UPDATE public.%I SET %s, plan_archived_at = NULL, plan_archived_prev = NULL WHERE id = ANY($1) AND account_id = $2',
                     r.tbl, r.restore_set)
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

-- What switching to p_plan would do, per resource: [{key, limit, count, archive, restore, names}]. Read-only.
CREATE OR REPLACE FUNCTION public.plan_archive_preview(p_account uuid, p_plan text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.plan_archive_resource;
  p record;
  lim integer;
  res jsonb := '[]';
BEGIN
  FOR r IN SELECT * FROM public._plan_archive_resources() LOOP
    lim := public._plan_limit_for(p_account, p_plan, r.limit_key);
    SELECT * INTO p FROM public._plan_archive_plan(p_account, r, lim);
    IF cardinality(p.to_archive) > 0 OR cardinality(p.to_restore) > 0 THEN
      res := res || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'limit', lim, 'count', p.counted,
        'archive', cardinality(p.to_archive), 'restore', cardinality(p.to_restore),
        'names', to_jsonb(CASE WHEN cardinality(p.to_archive) > 0 THEN p.archive_names[1:5] ELSE p.restore_names[1:5] END)));
    END IF;
  END LOOP;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.plan_archive_preview(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_archive_preview(uuid, text) TO service_role;

-- {resource key: how many the plan has archived right now}
CREATE OR REPLACE FUNCTION public.plan_archived_summary(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.plan_archive_resource;
  n integer;
  res jsonb := '{}';
BEGIN
  FOR r IN SELECT * FROM public._plan_archive_resources() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE account_id = $1 AND plan_archived_at IS NOT NULL', r.tbl) INTO n USING p_account;
    IF n > 0 THEN res := res || jsonb_build_object(r.key, n); END IF;
  END LOOP;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.plan_archived_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_archived_summary(uuid) TO service_role;

-- A person switching a plan-archived item back on: allowed while there is room (and it then counts again).
CREATE OR REPLACE FUNCTION public.plan_archive_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.plan_archive_resource;
  n jsonb := to_jsonb(NEW);
  o jsonb := to_jsonb(OLD);
  turning_on boolean;
  lim integer;
  cnt integer;
BEGIN
  IF OLD.plan_archived_at IS NULL OR NEW.plan_archived_at IS NULL THEN RETURN NEW; END IF;
  IF current_setting('ogadesk.plan_engine', true) = 'on' THEN RETURN NEW; END IF;
  turning_on := CASE TG_TABLE_NAME
    WHEN 'forms' THEN o->>'archived_at' IS NOT NULL AND n->>'archived_at' IS NULL
    WHEN 'custom_fields' THEN o->>'archived_at' IS NOT NULL AND n->>'archived_at' IS NULL
    WHEN 'custom_tables' THEN o->>'archived_at' IS NOT NULL AND n->>'archived_at' IS NULL
    WHEN 'automations' THEN (n->>'is_active')::boolean AND NOT (o->>'is_active')::boolean
    WHEN 'webhook_endpoints' THEN (n->>'is_active')::boolean AND NOT (o->>'is_active')::boolean
    WHEN 'flows' THEN o->>'status' = 'archived' AND n->>'status' <> 'archived'
    WHEN 'integrations' THEN o->>'status' = 'disabled' AND n->>'status' <> 'disabled'
    ELSE false END;
  IF NOT coalesce(turning_on, false) THEN RETURN NEW; END IF;
  SELECT * INTO r FROM public._plan_archive_resources() x WHERE x.tbl = TG_TABLE_NAME;
  lim := public.account_limit(NEW.account_id, r.limit_key);
  IF lim IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.account_id = $1 AND t.plan_archived_at IS NULL AND (%s)', r.tbl, r.counted)
      INTO cnt USING NEW.account_id;
    IF cnt >= lim THEN
      RAISE EXCEPTION 'plan_limit:%:%', r.limit_key, lim USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.plan_archived_at := NULL;
  NEW.plan_archived_prev := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.plan_archive_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forms','custom_fields','custom_tables','automations','flows','webhook_endpoints','integrations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS plan_archive_guard ON public.%I', t);
    EXECUTE format('CREATE TRIGGER plan_archive_guard BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.plan_archive_guard()', t);
  END LOOP;
END $$;

-- Run the engine whenever the plan that applies to a workspace changes. Never blocks the change itself.
CREATE OR REPLACE FUNCTION public.plan_archive_on_subscription()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.limit_overrides IS NOT DISTINCT FROM OLD.limit_overrides THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.enforce_plan_limits(NEW.account_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_plan_limits(%) failed: %', NEW.account_id, SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.plan_archive_on_subscription() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS plan_archive_on_subscription ON public.account_subscriptions;
CREATE TRIGGER plan_archive_on_subscription AFTER INSERT OR UPDATE ON public.account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.plan_archive_on_subscription();

-- The admin lowering (or raising) a plan's limits applies to every workspace on that plan.
CREATE OR REPLACE FUNCTION public.plan_archive_on_plan_limits()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE a uuid;
BEGIN
  IF NEW.limits IS NOT DISTINCT FROM OLD.limits THEN RETURN NULL; END IF;
  FOR a IN SELECT account_id FROM account_subscriptions
            WHERE (CASE WHEN status IN ('canceled', 'past_due') THEN 'free' ELSE plan_id END) = NEW.id LOOP
    BEGIN
      PERFORM public.enforce_plan_limits(a);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_plan_limits(%) failed: %', a, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.plan_archive_on_plan_limits() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS plan_archive_on_plan_limits ON public.plans;
CREATE TRIGGER plan_archive_on_plan_limits AFTER UPDATE OF limits ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.plan_archive_on_plan_limits();
