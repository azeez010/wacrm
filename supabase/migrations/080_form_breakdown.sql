-- ============================================================
-- 080_form_breakdown.sql
--
-- Results screen: where leads were NOT accepted, and what device they used.
-- Companion to form_stats (077): same membership check, same date window,
-- exact counts over the whole range (not just the rows the table loads).
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.form_breakdown(p_form_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM forms WHERE id = p_form_id;
  IF v_account IS NULL OR NOT public.is_account_member(v_account) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'by_device', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(NULLIF(device, ''), '(unknown)') AS k, count(*) AS n
              FROM form_submissions
             WHERE form_id = p_form_id AND NOT is_test AND outcome IN ('accepted', 'held')
               AND created_at >= p_from AND created_at < p_to
             GROUP BY 1 ORDER BY 2 DESC LIMIT 10) s), '[]'::jsonb),
    'rejected', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(NULLIF(reject_reason, ''), '(other)') AS k, count(*) AS n
              FROM form_submissions
             WHERE form_id = p_form_id AND NOT is_test AND outcome IN ('rejected', 'blocked', 'spam')
               AND created_at >= p_from AND created_at < p_to
             GROUP BY 1 ORDER BY 2 DESC LIMIT 10) s), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.form_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_breakdown(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
