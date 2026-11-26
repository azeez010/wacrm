-- ============================================================
-- 114_default_support_pipeline.sql
-- Every account always has a Support pipeline (tickets) to start from.
--   * public.ensure_support_pipeline(account) : creates "Support" with the default
--     stages (same as DEFAULT_STAGES_BY_KIND.support in src/lib/pipelines/kinds.ts)
--     when the account has no support pipeline yet.
--   * Backfill for every existing account.
--   * AFTER INSERT trigger on accounts, so new users (and any future workspace) get one.
-- A pipeline deleted on purpose later stays deleted (nothing re-creates it).
-- Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_support_pipeline(p_account uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM pipelines WHERE account_id = p_account AND kind = 'support' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT owner_user_id INTO v_owner FROM accounts WHERE id = p_account;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  INSERT INTO pipelines (user_id, account_id, name, kind)
  VALUES (v_owner, p_account, 'Support', 'support')
  RETURNING id INTO v_id;

  INSERT INTO pipeline_stages (pipeline_id, name, color, outcome, position) VALUES
    (v_id, 'New',                 '#3b82f6', NULL,   0),
    (v_id, 'In progress',         '#f59e0b', NULL,   1),
    (v_id, 'Waiting on customer', '#8b5cf6', NULL,   2),
    (v_id, 'Resolved',            '#22c55e', 'won',  3),
    (v_id, 'Closed',              '#64748b', 'lost', 4);

  RETURN v_id;
END;
$$;
ALTER FUNCTION public.ensure_support_pipeline(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ensure_support_pipeline(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accounts_create_support_pipeline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_support_pipeline(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block account creation (signup) over a pipeline.
  RAISE WARNING 'support pipeline for account % failed: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.accounts_create_support_pipeline() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.accounts_create_support_pipeline() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS accounts_support_pipeline ON accounts;
CREATE TRIGGER accounts_support_pipeline
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounts_create_support_pipeline();

SELECT public.ensure_support_pipeline(id) FROM accounts;
