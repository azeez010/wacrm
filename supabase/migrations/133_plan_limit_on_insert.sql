-- ============================================================
-- 133_plan_limit_on_insert.sql — the plan's count limits, enforced by the database for archivable resources
--
-- Until now only some ways in checked these limits (the public API, the forms and custom-field helpers); creating
-- an automation, a chatbot flow or a quick reply from the dashboard did not check at all. Since 132 archives what
-- no longer fits a lower plan, a new item must not slip past the limit either. Same shape as the contacts limit:
-- BEFORE INSERT, 'plan_limit:<key>:<n>' (P0001), which every screen turns into the upgrade dialog.
--
-- Counts follow 132 exactly (the same _plan_archive_resources list): items the plan archived and items a person
-- archived (forms, custom fields/tables) do not count; system automations and fields that belong to a custom
-- table are never limited here. Pipelines and message templates are not covered (default pipelines are created
-- for every workspace; templates are synced from Meta).
-- Idempotent.
-- ============================================================
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.plan_limit_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.plan_archive_resource;
  applies boolean;
  lim integer;
  cnt integer;
BEGIN
  SELECT * INTO r FROM public._plan_archive_resources() x WHERE x.tbl = TG_TABLE_NAME;
  IF r.tbl IS NULL THEN RETURN NEW; END IF;
  -- Does the new row count toward the limit (e.g. not a system automation, not a table's own field)?
  EXECUTE format('SELECT %s FROM (SELECT ($1::public.%I).*) t', r.counted, r.tbl) INTO applies USING NEW;
  IF NOT coalesce(applies, false) OR NEW.plan_archived_at IS NOT NULL THEN RETURN NEW; END IF;
  lim := public.account_limit(NEW.account_id, r.limit_key);
  IF lim IS NULL THEN RETURN NEW; END IF;
  -- One insert at a time per workspace and resource, so two quick clicks cannot both slip under the limit.
  PERFORM pg_advisory_xact_lock(hashtext('plan_limit:' || r.tbl || ':' || NEW.account_id::text));
  EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.account_id = $1 AND t.plan_archived_at IS NULL AND (%s)', r.tbl, r.counted)
    INTO cnt USING NEW.account_id;
  IF cnt >= lim THEN
    RAISE EXCEPTION 'plan_limit:%:%', r.limit_key, lim USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.plan_limit_on_insert() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['forms','custom_fields','custom_tables','automations','flows','webhook_endpoints','integrations','quick_replies'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS plan_limit_on_insert ON public.%I', t);
    EXECUTE format('CREATE TRIGGER plan_limit_on_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.plan_limit_on_insert()', t);
  END LOOP;
END $$;
