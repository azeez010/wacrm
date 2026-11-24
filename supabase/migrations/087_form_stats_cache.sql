-- ============================================================
-- 087_form_stats_cache.sql — pre-computed stats for the forms list
--
-- The forms list used to count leads in the browser from up to 5000
-- submission rows (wrong above that) and showed no views or trend. Instead,
-- `forms.stats_cache` holds a small JSON summary that a scheduled job
-- refreshes every few minutes, so the list reads one column per form:
--
--   { window_days, views, visitors, starts, leads, attention, conversion, last_lead_at,
--     spark: [14 daily lead counts, oldest first] }
--
--   views      page opens in the last 30 days (form_events type 'view')
--   visitors   distinct visitors who opened it (visitor id, per browser)
--   starts     distinct visitors who started filling it in
--   leads      accepted + held submissions, test submissions excluded
--   conversion leads / visitors as a percentage (null without visitors)
--   attention  accepted leads where a follow-up step failed (needs a look)
--
-- `refresh_form_stats(p_form_id)` recomputes one form, or (no argument) every
-- form with recent activity or an existing cache. Service-role only; the cron
-- route /api/forms/stats/cron calls it. The Results tab stays live.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS stats_cache jsonb,
  ADD COLUMN IF NOT EXISTS stats_updated_at timestamptz;

-- The refresh counts events per form by type over a window.
CREATE INDEX IF NOT EXISTS form_events_form_type_created_idx
  ON form_events (form_id, type, created_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_form_stats(p_form_id uuid DEFAULT NULL)
RETURNS integer AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH targets AS (
    SELECT f.id
    FROM forms f
    WHERE f.archived_at IS NULL
      AND (
        f.id = p_form_id
        OR (
          p_form_id IS NULL
          AND (
            f.stats_cache IS NOT NULL
            OR EXISTS (SELECT 1 FROM form_events e WHERE e.form_id = f.id AND e.created_at >= now() - interval '30 days')
            OR EXISTS (SELECT 1 FROM form_submissions s WHERE s.form_id = f.id AND s.created_at >= now() - interval '30 days')
          )
        )
      )
  ),
  ev AS (
    SELECT
      e.form_id,
      count(*) FILTER (WHERE e.type = 'view') AS views,
      count(DISTINCT e.visitor_id) FILTER (WHERE e.type = 'view') AS visitors,
      count(DISTINCT e.visitor_id) FILTER (WHERE e.type = 'start') AS starts
    FROM form_events e
    JOIN targets t ON t.id = e.form_id
    WHERE e.is_test = false AND e.created_at >= now() - interval '30 days'
    GROUP BY e.form_id
  ),
  sub AS (
    SELECT
      s.form_id,
      count(*) AS leads,
      count(*) FILTER (
        WHERE s.outcome = 'accepted'
          AND jsonb_typeof(s.processing -> 'steps') = 'object'
          AND EXISTS (SELECT 1 FROM jsonb_each(s.processing -> 'steps') x WHERE x.value ->> 'ok' = 'false')
      ) AS attention,
      max(s.created_at) AS last_lead_at
    FROM form_submissions s
    JOIN targets t ON t.id = s.form_id
    WHERE s.is_test = false
      AND s.outcome IN ('accepted', 'held')
      AND s.created_at >= now() - interval '30 days'
    GROUP BY s.form_id
  ),
  daily AS (
    SELECT s.form_id, (s.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
    FROM form_submissions s
    JOIN targets t ON t.id = s.form_id
    WHERE s.is_test = false
      AND s.outcome IN ('accepted', 'held')
      AND s.created_at >= ((now() AT TIME ZONE 'UTC')::date - 13)::timestamp AT TIME ZONE 'UTC'
    GROUP BY 1, 2
  ),
  spark AS (
    SELECT
      t.id AS form_id,
      array_agg(coalesce(d.n, 0) ORDER BY g.day) AS arr
    FROM targets t
    CROSS JOIN generate_series((now() AT TIME ZONE 'UTC')::date - 13, (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS g(day)
    LEFT JOIN daily d ON d.form_id = t.id AND d.day = g.day::date
    GROUP BY t.id
  )
  UPDATE forms f
  SET
    stats_cache = jsonb_build_object(
      'window_days', 30,
      'views', coalesce(ev.views, 0),
      'visitors', coalesce(ev.visitors, 0),
      'starts', coalesce(ev.starts, 0),
      'leads', coalesce(sub.leads, 0),
      'attention', coalesce(sub.attention, 0),
      'conversion',
        CASE WHEN coalesce(ev.visitors, 0) > 0
          THEN least(100, round(100.0 * coalesce(sub.leads, 0) / ev.visitors, 1))
          ELSE NULL
        END,
      'last_lead_at', sub.last_lead_at,
      'spark', to_jsonb(coalesce(spark.arr, ARRAY[]::int[]))
    ),
    stats_updated_at = now()
  FROM targets t
  LEFT JOIN ev ON ev.form_id = t.id
  LEFT JOIN sub ON sub.form_id = t.id
  LEFT JOIN spark ON spark.form_id = t.id
  WHERE f.id = t.id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.refresh_form_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_form_stats(uuid) TO service_role;
