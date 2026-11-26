-- ============================================================
-- 103_admin_deletion_requests.sql
-- Process Meta / email data-deletion requests from the admin console. The console never sees
-- meta_user_id. Writes are limited to status, note and completed_at; the API audits every change.
--   admin.deletion_list(status)                         queue (id, code, source, status, note, dates)
--   admin.deletion_set_status(id, status, note)         received -> in_progress -> completed | rejected
--   admin.deletion_log_email(note)                      register a request that arrived by email
-- Tracks the request only: wacrm has no automatic erasure procedure. Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION admin.deletion_list(p_status text DEFAULT NULL)
RETURNS TABLE (id uuid, confirmation_code text, source text, status text, note text, created_at timestamptz, completed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT d.id, d.confirmation_code, d.source, d.status, d.note, d.created_at, d.completed_at
    FROM data_deletion_requests d
   WHERE p_status IS NULL OR d.status = p_status
   ORDER BY (d.status IN ('received', 'in_progress')) DESC, d.created_at ASC
   LIMIT 500
$$;

CREATE OR REPLACE FUNCTION admin.deletion_set_status(p_id uuid, p_status text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, admin
AS $$
DECLARE
  cur text;
  before jsonb;
BEGIN
  IF p_status NOT IN ('in_progress', 'completed', 'rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT status, jsonb_build_object('status', status, 'note', note) INTO cur, before FROM data_deletion_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF cur IN ('completed', 'rejected') THEN RAISE EXCEPTION 'already_closed'; END IF;
  UPDATE data_deletion_requests
     SET status = p_status, note = coalesce(nullif(btrim(p_note), ''), note),
         completed_at = CASE WHEN p_status IN ('completed', 'rejected') THEN now() ELSE NULL END
   WHERE id = p_id;
  RETURN before;
END $$;

CREATE OR REPLACE FUNCTION admin.deletion_log_email(p_note text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public, admin
AS $$
  INSERT INTO data_deletion_requests (source, status, note, confirmation_code)
  VALUES ('email', 'received', nullif(btrim(p_note), ''), upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10)))
  RETURNING id
$$;

REVOKE ALL ON FUNCTION admin.deletion_list(text), admin.deletion_set_status(uuid, text, text), admin.deletion_log_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.deletion_list(text), admin.deletion_set_status(uuid, text, text), admin.deletion_log_email(text) TO ogadesk_admin_api;
