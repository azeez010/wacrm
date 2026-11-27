-- ============================================================
-- 125_workspace_scope.sql — every workspace is fully separate
--
-- Row-level security used to let a person read and write the rows of EVERY workspace
-- they belong to (is_account_member() is true for any membership); only the app's
-- account filters kept workspaces apart. This adds one RESTRICTIVE policy per tenant
-- table so the DATABASE itself only shows and accepts rows of the person's ACTIVE
-- workspace (current_account_id(), migration 116). Restrictive policies are AND-ed with
-- the existing ones, so roles and permissions are unchanged. Child tables (messages,
-- pipeline_stages, contact_tags, ...) read their parent in their own policies, so they
-- follow the parent's scope.
--
--   * public.enforce_workspace_scope(table)  adds/refreshes the policy on one table
--   * public.drop_workspace_scope()          kill switch: removes every workspace_scope policy
--   * Not scoped on purpose: account_members (the switcher lists all your workspaces),
--     profiles (a person), accounts (keyed by id), and the service-only tables with no
--     client policy (api_key_secrets, automation_pending_executions, crm_outbox,
--     form_events, otp_verifications, pending_message_statuses).
-- The service role, the admin API role and anon (public forms) are not affected.
-- A new table with an account_id must call enforce_workspace_scope in its migration
-- (src/lib/auth/workspace-scope-migration.test.ts enforces it). Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_workspace_scope(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = p_table AND attname = 'account_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '% has no account_id column', p_table;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS workspace_scope ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY workspace_scope ON %s AS RESTRICTIVE FOR ALL TO authenticated '
    || 'USING (account_id = (SELECT public.current_account_id())) '
    || 'WITH CHECK (account_id = (SELECT public.current_account_id()))',
    p_table);
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_workspace_scope(regclass) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.drop_workspace_scope()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_policies
            WHERE schemaname = 'public' AND policyname = 'workspace_scope' LOOP
    EXECUTE format('DROP POLICY workspace_scope ON %I.%I', r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.drop_workspace_scope() FROM PUBLIC, anon, authenticated;

SELECT public.enforce_workspace_scope('public.account_invitations'::regclass);
SELECT public.enforce_workspace_scope('public.account_subscriptions'::regclass);
SELECT public.enforce_workspace_scope('public.ai_agent_knowledge'::regclass);
SELECT public.enforce_workspace_scope('public.ai_agents'::regclass);
SELECT public.enforce_workspace_scope('public.ai_configs'::regclass);
SELECT public.enforce_workspace_scope('public.ai_knowledge_chunks'::regclass);
SELECT public.enforce_workspace_scope('public.ai_knowledge_documents'::regclass);
SELECT public.enforce_workspace_scope('public.ai_knowledge_sources'::regclass);
SELECT public.enforce_workspace_scope('public.ai_tool_calls'::regclass);
SELECT public.enforce_workspace_scope('public.ai_usage_log'::regclass);
SELECT public.enforce_workspace_scope('public.api_keys'::regclass);
SELECT public.enforce_workspace_scope('public.automation_logs'::regclass);
SELECT public.enforce_workspace_scope('public.automations'::regclass);
SELECT public.enforce_workspace_scope('public.broadcasts'::regclass);
SELECT public.enforce_workspace_scope('public.checkout_sessions'::regclass);
SELECT public.enforce_workspace_scope('public.contact_custom_values'::regclass);
SELECT public.enforce_workspace_scope('public.contact_notes'::regclass);
SELECT public.enforce_workspace_scope('public.contacts'::regclass);
SELECT public.enforce_workspace_scope('public.conversations'::regclass);
SELECT public.enforce_workspace_scope('public.custom_fields'::regclass);
SELECT public.enforce_workspace_scope('public.custom_records'::regclass);
SELECT public.enforce_workspace_scope('public.custom_tables'::regclass);
SELECT public.enforce_workspace_scope('public.deals'::regclass);
SELECT public.enforce_workspace_scope('public.flow_runs'::regclass);
SELECT public.enforce_workspace_scope('public.flows'::regclass);
SELECT public.enforce_workspace_scope('public.form_submissions'::regclass);
SELECT public.enforce_workspace_scope('public.forms'::regclass);
SELECT public.enforce_workspace_scope('public.integration_tools'::regclass);
SELECT public.enforce_workspace_scope('public.integrations'::regclass);
SELECT public.enforce_workspace_scope('public.media_assets'::regclass);
SELECT public.enforce_workspace_scope('public.member_presence'::regclass);
SELECT public.enforce_workspace_scope('public.message_templates'::regclass);
SELECT public.enforce_workspace_scope('public.notifications'::regclass);
SELECT public.enforce_workspace_scope('public.pipelines'::regclass);
SELECT public.enforce_workspace_scope('public.push_subscriptions'::regclass);
SELECT public.enforce_workspace_scope('public.quick_replies'::regclass);
SELECT public.enforce_workspace_scope('public.segments'::regclass);
SELECT public.enforce_workspace_scope('public.subscription_payments'::regclass);
SELECT public.enforce_workspace_scope('public.tags'::regclass);
SELECT public.enforce_workspace_scope('public.webhook_deliveries'::regclass);
SELECT public.enforce_workspace_scope('public.webhook_endpoints'::regclass);
SELECT public.enforce_workspace_scope('public.whatsapp_config'::regclass);
