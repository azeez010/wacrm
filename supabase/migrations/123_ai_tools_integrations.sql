-- ============================================================
-- 123_ai_tools_integrations.sql
--
-- AI tools: a business connects INTEGRATIONS (any MCP server, custom HTTP actions, Google Calendar, Paystack payment
-- links) and the AI can call their TOOLS while replying.
--   integrations        one connection; secrets (tokens, keys, OAuth refresh tokens) encrypted by the app with ENCRYPTION_KEY
--   integration_tools   the tools it exposes: read (runs automatically) or action (needs approval unless auto_approve)
--   ai_tool_calls       every call the AI made or proposed: the activity log AND the approval queue
--   ai_agents.tool_integrations   which integrations an agent may use (NULL = all)
-- Plan: feature `ai_tools` + limit `integrations_max` (set per plan in the admin Plans page). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('mcp', 'http', 'google_calendar', 'paystack')),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  status        text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'needs_reauth', 'disabled')),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secrets       text,
  secret_hints  jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ok_at    timestamptz,
  last_error_at timestamptz,
  last_error    text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integrations_account_idx ON public.integrations (account_id, created_at);

CREATE TABLE IF NOT EXISTS public.integration_tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (name ~ '^[A-Za-z0-9_.-]{1,64}$'),
  title          text,
  description    text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  input_schema   jsonb NOT NULL DEFAULT '{"type":"object","properties":{}}'::jsonb,
  kind           text NOT NULL DEFAULT 'action' CHECK (kind IN ('read', 'action')),
  enabled        boolean NOT NULL DEFAULT true,
  auto_approve   boolean NOT NULL DEFAULT false,
  source         text NOT NULL DEFAULT 'defined' CHECK (source IN ('discovered', 'defined', 'builtin')),
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, name)
);
CREATE INDEX IF NOT EXISTS integration_tools_account_idx ON public.integration_tools (account_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.ai_tool_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  tool_id         uuid REFERENCES public.integration_tools(id) ON DELETE SET NULL,
  integration_id  uuid REFERENCES public.integrations(id) ON DELETE SET NULL,
  tool_name       text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('auto_reply', 'draft', 'playground', 'manual')),
  kind            text NOT NULL CHECK (kind IN ('read', 'action')),
  arguments       jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary         text,
  result          text,
  status          text NOT NULL CHECK (status IN ('ok', 'error', 'pending_approval', 'approved', 'rejected', 'expired', 'proposed')),
  error           text,
  duration_ms     integer,
  decided_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_tool_calls_account_idx ON public.ai_tool_calls (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_tool_calls_pending_idx ON public.ai_tool_calls (conversation_id) WHERE status = 'pending_approval';

ALTER TABLE public.ai_agents ADD COLUMN IF NOT EXISTS tool_integrations jsonb CHECK (tool_integrations IS NULL OR jsonb_typeof(tool_integrations) = 'array');

-- ---- RLS: members read; admins manage integrations/tools; tool calls are written by the server only ----
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_select ON public.integrations;
CREATE POLICY integrations_select ON public.integrations FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS integrations_write ON public.integrations;
CREATE POLICY integrations_write ON public.integrations FOR ALL USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_tools_select ON public.integration_tools;
CREATE POLICY integration_tools_select ON public.integration_tools FOR SELECT USING (public.is_account_member(account_id));
DROP POLICY IF EXISTS integration_tools_write ON public.integration_tools;
CREATE POLICY integration_tools_write ON public.integration_tools FOR ALL USING (public.is_account_member(account_id, 'admin')) WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_tool_calls_select ON public.ai_tool_calls;
CREATE POLICY ai_tool_calls_select ON public.ai_tool_calls FOR SELECT USING (public.is_account_member(account_id));

-- The encrypted secrets column is never readable from the browser: members get every column EXCEPT secrets.
REVOKE ALL ON public.integrations, public.integration_tools, public.ai_tool_calls FROM anon;
REVOKE ALL ON public.integrations FROM authenticated;
GRANT SELECT (id, account_id, kind, name, status, config, secret_hints, last_ok_at, last_error_at, last_error, created_by, created_at, updated_at)
  ON public.integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_tools TO authenticated, service_role;
GRANT SELECT ON public.ai_tool_calls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_tool_calls TO service_role;

DROP TRIGGER IF EXISTS integrations_touch ON public.integrations;
CREATE TRIGGER integrations_touch BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS integration_tools_touch ON public.integration_tools;
CREATE TRIGGER integration_tools_touch BEFORE UPDATE ON public.integration_tools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---- plan: feature + limit (starting values; edit them in the admin Plans page) ----
UPDATE public.plans SET features = features || jsonb_build_object('ai_tools', id <> 'free') WHERE NOT (features ? 'ai_tools');
UPDATE public.plans SET limits = limits || jsonb_build_object('integrations_max', CASE id WHEN 'free' THEN 0 WHEN 'starter' THEN 3 WHEN 'pro' THEN 20 ELSE 0 END)
 WHERE NOT (limits ? 'integrations_max');
