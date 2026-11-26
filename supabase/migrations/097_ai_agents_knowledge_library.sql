-- ============================================================
-- 097_ai_agents_knowledge_library.sql: multiple AI agents + a reusable
-- knowledge library linked to them many-to-many.
--
--   ai_configs            stays the WORKSPACE level: provider, base URL,
--                         API key, embeddings key, master switch. The
--                         library is embedded once with one key, so every
--                         agent can search it.
--   ai_agents             one row per agent: prompt, model override,
--                         auto-reply settings, handoff target, channels,
--                         knowledge mode. Each account with an ai_configs
--                         row gets a "Default agent" copied from it, so
--                         nothing changes for existing users.
--   ai_knowledge_sources  the library item a user adds (pasted text, Q&A,
--                         file, web page, website). Indexed once.
--   ai_knowledge_documents  now one row per text / file / crawled page,
--                         belonging to a source.
--   ai_agent_knowledge    agent <-> source links (many-to-many). An agent in
--                         knowledge_mode 'all' searches the whole library
--                         and ignores its links.
--
-- Compatibility (until the old single-config UI is retired):
--   * a trigger mirrors the per-agent columns still written to ai_configs
--     onto the default agent, and creates the default agent on first save;
--   * a document inserted without a source gets a 'text' source made for
--     it; deleting the last document of a single-document source removes
--     the source.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Agents
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_agents (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description                      text,
  is_active                        boolean NOT NULL DEFAULT true,
  is_default                       boolean NOT NULL DEFAULT false,
  -- NULL = use the workspace model from ai_configs.
  model                            text,
  system_prompt                    text,
  auto_reply_enabled               boolean NOT NULL DEFAULT false,
  auto_reply_max_per_conversation  integer NOT NULL DEFAULT 3
                                     CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 20),
  -- The human teammate a handed-off chat is assigned to; NULL = shared queue.
  handoff_agent_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Which conversation channels this agent answers on.
  channels                         text[] NOT NULL DEFAULT ARRAY['whatsapp', 'web_chat']::text[]
                                     CHECK (channels <@ ARRAY['whatsapp', 'web_chat']::text[]),
  -- Higher wins when several agents cover the same channel.
  priority                         integer NOT NULL DEFAULT 0,
  knowledge_mode                   text NOT NULL DEFAULT 'selected'
                                     CHECK (knowledge_mode IN ('all', 'selected')),
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_agents_account_idx ON ai_agents (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_one_default_idx
  ON ai_agents (account_id) WHERE is_default;

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agents_select ON ai_agents;
CREATE POLICY ai_agents_select ON ai_agents FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS ai_agents_insert ON ai_agents;
CREATE POLICY ai_agents_insert ON ai_agents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agents_update ON ai_agents;
CREATE POLICY ai_agents_update ON ai_agents FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_agents_delete ON ai_agents;
CREATE POLICY ai_agents_delete ON ai_agents FOR DELETE
  USING (is_account_member(account_id, 'admin') AND NOT is_default);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_agents_updated_at ON ai_agents;
CREATE TRIGGER ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: one default agent per existing workspace config.
INSERT INTO ai_agents (
  account_id, created_by, name, is_active, is_default, model, system_prompt,
  auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id,
  channels, knowledge_mode
)
SELECT c.account_id, c.created_by, 'Default agent', true, true, NULL, c.system_prompt,
       c.auto_reply_enabled, c.auto_reply_max_per_conversation, c.handoff_agent_id,
       ARRAY['whatsapp', 'web_chat']::text[], 'all'
FROM ai_configs c
WHERE NOT EXISTS (
  SELECT 1 FROM ai_agents a WHERE a.account_id = c.account_id AND a.is_default
);

-- Keep the default agent in step with the legacy per-agent columns on
-- ai_configs while the old settings form still writes them. Creates the
-- default agent the first time a workspace saves its AI config.
CREATE OR REPLACE FUNCTION public.sync_default_ai_agent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ai_agents (
      account_id, created_by, name, is_default, system_prompt,
      auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id,
      channels, knowledge_mode
    )
    SELECT NEW.account_id, NEW.created_by, 'Default agent', true, NEW.system_prompt,
           NEW.auto_reply_enabled, NEW.auto_reply_max_per_conversation, NEW.handoff_agent_id,
           ARRAY['whatsapp', 'web_chat']::text[], 'all'
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_agents a WHERE a.account_id = NEW.account_id AND a.is_default
    );
    RETURN NEW;
  END IF;

  UPDATE ai_agents a
  SET system_prompt = NEW.system_prompt,
      auto_reply_enabled = NEW.auto_reply_enabled,
      auto_reply_max_per_conversation = NEW.auto_reply_max_per_conversation,
      handoff_agent_id = NEW.handoff_agent_id
  WHERE a.account_id = NEW.account_id
    AND a.is_default
    AND (
      NEW.system_prompt IS DISTINCT FROM OLD.system_prompt
      OR NEW.auto_reply_enabled IS DISTINCT FROM OLD.auto_reply_enabled
      OR NEW.auto_reply_max_per_conversation IS DISTINCT FROM OLD.auto_reply_max_per_conversation
      OR NEW.handoff_agent_id IS DISTINCT FROM OLD.handoff_agent_id
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_configs_sync_default_agent ON ai_configs;
CREATE TRIGGER ai_configs_sync_default_agent
  AFTER INSERT OR UPDATE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.sync_default_ai_agent();

-- ------------------------------------------------------------
-- 2. Knowledge sources (the library)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  type            text NOT NULL CHECK (type IN ('text', 'qa', 'file', 'url', 'website')),
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'ready', 'partial', 'failed')),
  error           text,
  -- Type-specific settings: { url } | { startUrl, maxPages, include[], exclude[] }
  -- | { fileName, mime, size, storagePath }.
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sync_interval   text NOT NULL DEFAULT 'none' CHECK (sync_interval IN ('none', 'daily', 'weekly')),
  last_synced_at  timestamptz,
  next_sync_at    timestamptz,
  doc_count       integer NOT NULL DEFAULT 0,
  chunk_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_sources_account_idx
  ON ai_knowledge_sources (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_next_sync_idx
  ON ai_knowledge_sources (next_sync_at) WHERE next_sync_at IS NOT NULL;

ALTER TABLE ai_knowledge_sources ENABLE ROW LEVEL SECURITY;

-- Any member reads; agents add; admins or the person who added it edit/delete.
DROP POLICY IF EXISTS ai_knowledge_sources_select ON ai_knowledge_sources;
CREATE POLICY ai_knowledge_sources_select ON ai_knowledge_sources FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS ai_knowledge_sources_insert ON ai_knowledge_sources;
CREATE POLICY ai_knowledge_sources_insert ON ai_knowledge_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND created_by = auth.uid());
DROP POLICY IF EXISTS ai_knowledge_sources_update ON ai_knowledge_sources;
CREATE POLICY ai_knowledge_sources_update ON ai_knowledge_sources FOR UPDATE
  USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND created_by = auth.uid())
  );
DROP POLICY IF EXISTS ai_knowledge_sources_delete ON ai_knowledge_sources;
CREATE POLICY ai_knowledge_sources_delete ON ai_knowledge_sources FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND created_by = auth.uid())
  );

DROP TRIGGER IF EXISTS ai_knowledge_sources_updated_at ON ai_knowledge_sources;
CREATE TRIGGER ai_knowledge_sources_updated_at
  BEFORE UPDATE ON ai_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- True when the caller may write the source's documents and chunks.
CREATE OR REPLACE FUNCTION public.can_edit_ai_knowledge_source(p_source_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_knowledge_sources s
    WHERE s.id = p_source_id
      AND (
        is_account_member(s.account_id, 'admin')
        OR (is_account_member(s.account_id, 'agent') AND s.created_by = auth.uid())
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_ai_knowledge_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_ai_knowledge_source(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Documents: one per text / file / page, under a source
-- ------------------------------------------------------------
ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_id     uuid REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS url           text,
  ADD COLUMN IF NOT EXISTS content_hash  text,
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS error         text,
  ADD COLUMN IF NOT EXISTS claimed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS chunk_count   integer NOT NULL DEFAULT 0;

ALTER TABLE ai_knowledge_documents DROP CONSTRAINT IF EXISTS ai_knowledge_documents_status_check;
ALTER TABLE ai_knowledge_documents ADD CONSTRAINT ai_knowledge_documents_status_check
  CHECK (status IN ('queued', 'processing', 'ready', 'failed'));

-- Backfill: every existing document becomes its own 'text' source. Reusing
-- the document id as the source id keeps the mapping trivial and re-runnable.
INSERT INTO ai_knowledge_sources (id, account_id, created_by, name, type, status, last_synced_at, doc_count, created_at)
SELECT d.id, d.account_id, d.created_by, left(d.title, 200), 'text', 'ready', d.updated_at, 1, d.created_at
FROM ai_knowledge_documents d
WHERE d.source_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE ai_knowledge_documents SET source_id = id WHERE source_id IS NULL;

UPDATE ai_knowledge_documents d
SET chunk_count = sub.n
FROM (SELECT document_id, count(*)::int AS n FROM ai_knowledge_chunks GROUP BY document_id) sub
WHERE sub.document_id = d.id AND d.chunk_count = 0;

UPDATE ai_knowledge_sources s
SET chunk_count = d.chunk_count
FROM ai_knowledge_documents d
WHERE d.source_id = s.id AND d.id = s.id AND s.chunk_count = 0;

-- Legacy inserts (no source) get a 'text' source made for them.
CREATE OR REPLACE FUNCTION public.ai_knowledge_document_default_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_id IS NULL THEN
    INSERT INTO ai_knowledge_sources (account_id, created_by, name, type, status, doc_count)
    VALUES (NEW.account_id, NEW.created_by, left(NEW.title, 200), 'text', 'ready', 1)
    RETURNING id INTO NEW.source_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_documents_default_source ON ai_knowledge_documents;
CREATE TRIGGER ai_knowledge_documents_default_source
  BEFORE INSERT ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_document_default_source();

-- Deleting the only document of a single-document source removes the source.
CREATE OR REPLACE FUNCTION public.ai_knowledge_document_cleanup_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM ai_knowledge_sources s
  WHERE s.id = OLD.source_id
    AND s.type IN ('text', 'qa', 'file', 'url')
    AND NOT EXISTS (SELECT 1 FROM ai_knowledge_documents d WHERE d.source_id = s.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_documents_cleanup_source ON ai_knowledge_documents;
CREATE TRIGGER ai_knowledge_documents_cleanup_source
  AFTER DELETE ON ai_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_document_cleanup_source();

ALTER TABLE ai_knowledge_documents ALTER COLUMN source_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_source_idx
  ON ai_knowledge_documents (source_id);
CREATE INDEX IF NOT EXISTS ai_knowledge_documents_queue_idx
  ON ai_knowledge_documents (status, created_at) WHERE status IN ('queued', 'processing');
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_documents_source_url_idx
  ON ai_knowledge_documents (source_id, url) WHERE url IS NOT NULL;

-- Writers: admins, or the agent who added the source.
DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND (source_id IS NULL OR can_edit_ai_knowledge_source(source_id)))
  );
DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents FOR UPDATE
  USING (is_account_member(account_id, 'admin') OR can_edit_ai_knowledge_source(source_id));
DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;
CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents FOR DELETE
  USING (is_account_member(account_id, 'admin') OR can_edit_ai_knowledge_source(source_id));

-- ------------------------------------------------------------
-- 4. Chunks carry their source for scoped retrieval
-- ------------------------------------------------------------
ALTER TABLE ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE;

UPDATE ai_knowledge_chunks c
SET source_id = d.source_id
FROM ai_knowledge_documents d
WHERE d.id = c.document_id AND c.source_id IS NULL;

CREATE OR REPLACE FUNCTION public.ai_knowledge_chunk_fill_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_id IS NULL THEN
    SELECT d.source_id INTO NEW.source_id FROM ai_knowledge_documents d WHERE d.id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_chunks_fill_source ON ai_knowledge_chunks;
CREATE TRIGGER ai_knowledge_chunks_fill_source
  BEFORE INSERT ON ai_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.ai_knowledge_chunk_fill_source();

ALTER TABLE ai_knowledge_chunks ALTER COLUMN source_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_source_idx
  ON ai_knowledge_chunks (source_id);

DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_insert ON ai_knowledge_chunks FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND (source_id IS NULL OR can_edit_ai_knowledge_source(source_id)))
  );
DROP POLICY IF EXISTS ai_knowledge_chunks_update ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_update ON ai_knowledge_chunks FOR UPDATE
  USING (is_account_member(account_id, 'admin') OR can_edit_ai_knowledge_source(source_id));
DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON ai_knowledge_chunks;
CREATE POLICY ai_knowledge_chunks_delete ON ai_knowledge_chunks FOR DELETE
  USING (is_account_member(account_id, 'admin') OR can_edit_ai_knowledge_source(source_id));

-- ------------------------------------------------------------
-- 5. Agent <-> source links
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_agent_knowledge (
  agent_id    uuid NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  source_id   uuid NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, source_id)
);

CREATE INDEX IF NOT EXISTS ai_agent_knowledge_source_idx ON ai_agent_knowledge (source_id);
CREATE INDEX IF NOT EXISTS ai_agent_knowledge_account_idx ON ai_agent_knowledge (account_id);

ALTER TABLE ai_agent_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agent_knowledge_select ON ai_agent_knowledge;
CREATE POLICY ai_agent_knowledge_select ON ai_agent_knowledge FOR SELECT
  USING (is_account_member(account_id));
-- Both ends must belong to the same account as the link.
DROP POLICY IF EXISTS ai_agent_knowledge_insert ON ai_agent_knowledge;
CREATE POLICY ai_agent_knowledge_insert ON ai_agent_knowledge FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'admin')
    AND EXISTS (SELECT 1 FROM ai_agents a WHERE a.id = agent_id AND a.account_id = ai_agent_knowledge.account_id)
    AND EXISTS (SELECT 1 FROM ai_knowledge_sources s WHERE s.id = source_id AND s.account_id = ai_agent_knowledge.account_id)
  );
DROP POLICY IF EXISTS ai_agent_knowledge_delete ON ai_agent_knowledge;
CREATE POLICY ai_agent_knowledge_delete ON ai_agent_knowledge FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Explicit table grants: newer Supabase projects no longer grant new public
-- tables to the API roles by default. RLS above still decides the rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_agents, ai_knowledge_sources, ai_agent_knowledge
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Which agent handles / wrote what
-- ------------------------------------------------------------
-- Manual per-conversation override (set from the inbox).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;
-- The agent that generated an AI message.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 7. Private bucket for uploaded knowledge files
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge-files',
  'knowledge-files',
  FALSE,
  20971520, -- 20 MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Members read knowledge files" ON storage.objects;
CREATE POLICY "Members read knowledge files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'knowledge-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Agents upload knowledge files" ON storage.objects;
CREATE POLICY "Agents upload knowledge files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'knowledge-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Uploaders and admins delete knowledge files" ON storage.objects;
CREATE POLICY "Uploaders and admins delete knowledge files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'knowledge-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (p.account_role IN ('owner', 'admin') OR (p.account_role = 'agent' AND owner = auth.uid()))
    )
  );

-- ------------------------------------------------------------
-- 8. Scoped retrieval RPCs. p_source_ids NULL = the whole library.
--    SECURITY INVOKER (see 032): RLS scopes authenticated callers; the
--    service role is additionally held to p_account_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts_v2(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer,
  p_source_ids  uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, source_id uuid, document_id uuid, doc_title text, content text, score real) AS $$
  WITH any_term AS (
    SELECT string_agg(
             '''' || replace(replace(lexeme, '\', '\\'), '''', '''''') || '''',
             ' | '
           )::tsquery AS query
    FROM unnest(tsvector_to_array(to_tsvector('simple', coalesce(p_query, '')))) AS lexeme
  )
  SELECT c.id,
         c.source_id,
         c.document_id,
         d.title,
         c.content,
         ts_rank(c.fts, any_term.query) AS score
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_documents d ON d.id = c.document_id
  CROSS JOIN any_term
  WHERE any_term.query IS NOT NULL
    AND c.account_id = p_account_id
    AND (p_source_ids IS NULL OR c.source_id = ANY (p_source_ids))
    AND c.fts @@ any_term.query
  ORDER BY score DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_semantic_v2(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer,
  p_source_ids      uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, source_id uuid, document_id uuid, doc_title text, content text, score real) AS $$
  SELECT c.id,
         c.source_id,
         c.document_id,
         d.title,
         c.content,
         (1 - (c.embedding <=> p_query_embedding::vector(1536)))::real AS score
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_documents d ON d.id = c.document_id
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
    AND (p_source_ids IS NULL OR c.source_id = ANY (p_source_ids))
  ORDER BY c.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts_v2(uuid, text, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts_v2(uuid, text, integer, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic_v2(uuid, text, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic_v2(uuid, text, integer, uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 9. Ingestion queue claim (service role only). Takes queued documents,
--    plus 'processing' ones stuck for over 10 minutes (a crashed run).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ai_knowledge_documents(p_limit integer)
RETURNS SETOF ai_knowledge_documents
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH picked AS (
    SELECT d.id
    FROM ai_knowledge_documents d
    WHERE d.status = 'queued'
       OR (d.status = 'processing' AND d.claimed_at < now() - interval '10 minutes')
    ORDER BY d.created_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE ai_knowledge_documents d
  SET status = 'processing', claimed_at = now()
  FROM picked
  WHERE d.id = picked.id
  RETURNING d.*;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_knowledge_documents(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_knowledge_documents(integer) TO service_role;

-- ------------------------------------------------------------
-- 10. redeem_invitation: agents and library sources count as "has data".
--     Body identical to 077 plus the two new tables.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_agents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_sources WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM segments WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_tables WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_records WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_custom_values WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM forms WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM form_submissions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM form_events WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
