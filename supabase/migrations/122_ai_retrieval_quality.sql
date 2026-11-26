-- ============================================================
-- 122_ai_retrieval_quality.sql: knowledge retrieval quality + sources.
--
--   * ai_knowledge_chunks.doc_title: the document title, copied onto each
--     chunk and weighted A in the keyword index (the body is B), so a
--     question naming the topic ranks that document first. Kept in step
--     by triggers on chunk insert and on document title change.
--   * messages.ai_sources: the knowledge an AI reply was grounded in
--     ([{source_id, document_id, title, score, matched_by}]), shown in the
--     inbox.
--
-- The match RPCs read c.fts, so they pick up the weighting unchanged
-- (ts_rank weighs A above B by default). Idempotent.
-- ============================================================

ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS doc_title text;

UPDATE ai_knowledge_chunks c
SET doc_title = d.title
FROM ai_knowledge_documents d
WHERE d.id = c.document_id AND c.doc_title IS DISTINCT FROM d.title;

-- Rebuild the generated keyword column with the title weighted in. A
-- generated column can't be altered, so drop and re-add (its GIN index
-- goes with it and is recreated).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.ai_knowledge_chunks'::regclass
      AND attname = 'fts'
      AND pg_get_expr(
            (SELECT adbin FROM pg_attrdef WHERE adrelid = attrelid AND adnum = attnum),
            attrelid
          ) LIKE '%doc_title%'
  ) THEN
    ALTER TABLE ai_knowledge_chunks DROP COLUMN IF EXISTS fts;
    ALTER TABLE ai_knowledge_chunks ADD COLUMN fts tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(doc_title, '')), 'A') ||
      setweight(to_tsvector('simple', content), 'B')
    ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING gin (fts);

-- New chunks take their document's title (and source, as in 097).
CREATE OR REPLACE FUNCTION public.ai_knowledge_chunk_fill_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source_id IS NULL OR NEW.doc_title IS NULL THEN
    SELECT coalesce(NEW.source_id, d.source_id), coalesce(NEW.doc_title, d.title)
      INTO NEW.source_id, NEW.doc_title
    FROM ai_knowledge_documents d
    WHERE d.id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$;

-- A renamed document (or a crawled page whose <title> was just read)
-- updates its chunks.
CREATE OR REPLACE FUNCTION public.ai_knowledge_document_title_to_chunks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE ai_knowledge_chunks SET doc_title = NEW.title WHERE document_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_knowledge_documents_title_to_chunks ON ai_knowledge_documents;
CREATE TRIGGER ai_knowledge_documents_title_to_chunks
  AFTER UPDATE OF title ON ai_knowledge_documents
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION public.ai_knowledge_document_title_to_chunks();

-- What an AI reply was grounded in.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ai_sources jsonb;
