-- ============================================================
-- 067_segments_and_filter_contacts.sql
--
--   * segments: saved, dynamic filters (re-evaluated every time they
--     are used, never snapshots).
--   * contact_matches_filter(): evaluates one versioned FilterGroup
--     JSON against a contact. Pure SQL/plpgsql with NO dynamic SQL, so
--     user-supplied JSON can never be executed as SQL.
--   * filter_contacts(): paged, sorted, counted contact search that the
--     contacts list, segments, broadcasts and the API all share.
--   * count_contacts(): count only (live "N match" numbers).
--
-- FilterGroup:
--   { "version": 1, "op": "and" | "or",
--     "rules": [ {"field": "...", "operator": "...", "value": ...}
--              | <FilterGroup> ] }
--   field: name | phone | email | company | created_at | tags | cf:<uuid>
--
-- Rules that point at a deleted/archived field or use an operator that
-- does not fit the field's type are SKIPPED (not an error), so an old
-- segment keeps working after a field is removed.
--
-- Relative dates ('today', '+7d', '-30d') resolve against UTC.
-- SECURITY INVOKER: RLS on contacts / contact_custom_values scopes
-- everything to the caller's account. Service-role callers (API keys,
-- broadcasts) MUST pass p_account_id since the service role bypasses RLS.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS segments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  filter      JSONB NOT NULL DEFAULT '{"version":1,"op":"and","rules":[]}'::jsonb,
  source      TEXT,
  locked      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT segments_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_segments_account_name
  ON segments(account_id, lower(name));

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS segments_select ON segments;
DROP POLICY IF EXISTS segments_insert ON segments;
DROP POLICY IF EXISTS segments_update ON segments;
DROP POLICY IF EXISTS segments_delete ON segments;
CREATE POLICY segments_select ON segments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY segments_insert ON segments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY segments_update ON segments FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND NOT locked);
CREATE POLICY segments_delete ON segments FOR DELETE
  USING (is_account_member(account_id, 'agent') AND NOT locked);

-- ------------------------------------------------------------
-- Date helper: absolute (YYYY-MM-DD / ISO) or relative token -> UTC day
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filter_resolve_day(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v TEXT := lower(btrim(COALESCE(p_value, '')));
  today TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
  m TEXT[];
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v = 'today' THEN RETURN today; END IF;
  IF v = 'yesterday' THEN RETURN today - interval '1 day'; END IF;
  IF v = 'tomorrow' THEN RETURN today + interval '1 day'; END IF;
  m := regexp_match(v, '^([+-])(\d{1,5})([dwmy])$');
  IF m IS NOT NULL THEN
    RETURN today + (
      (CASE m[1] WHEN '-' THEN -1 ELSE 1 END)
      * m[2]::int
      * (CASE m[3]
           WHEN 'd' THEN interval '1 day'
           WHEN 'w' THEN interval '7 days'
           WHEN 'm' THEN interval '1 month'
           ELSE interval '1 year'
         END)
    );
  END IF;
  RETURN date_trunc('day', v::timestamptz AT TIME ZONE 'utc') AT TIME ZONE 'utc';
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- One rule. Returns TRUE/FALSE, or NULL to mean "skip this rule".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_matches_rule(c contacts, rule JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  fld   TEXT := rule->>'field';
  op    TEXT := rule->>'operator';
  val   JSONB := rule->'value';
  vtxt  TEXT := rule->>'value';
  col   TEXT;
  cf    custom_fields%ROWTYPE;
  fid   UUID;
  d1    TIMESTAMPTZ;
  d2    TIMESTAMPTZ;
  n1    NUMERIC;
  n2    NUMERIC;
  arr_t TEXT[];
  arr_u UUID[];
BEGIN
  IF fld IS NULL OR op IS NULL THEN RETURN NULL; END IF;

  -- ---------------- built-in text columns ----------------
  IF fld IN ('name', 'phone', 'email', 'company') THEN
    col := CASE fld
             WHEN 'name' THEN COALESCE(c.name, '')
             WHEN 'phone' THEN COALESCE(c.phone, '')
             WHEN 'email' THEN COALESCE(c.email, '')
             ELSE COALESCE(c.company, '')
           END;
    RETURN CASE op
      WHEN 'contains'     THEN vtxt IS NOT NULL AND vtxt <> '' AND col ILIKE '%' || replace(replace(replace(vtxt, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      WHEN 'not_contains' THEN vtxt IS NULL OR vtxt = '' OR col NOT ILIKE '%' || replace(replace(replace(vtxt, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      WHEN 'equals'       THEN lower(col) = lower(COALESCE(vtxt, ''))
      WHEN 'not_equals'   THEN lower(col) <> lower(COALESCE(vtxt, ''))
      WHEN 'is_empty'     THEN btrim(col) = ''
      WHEN 'is_set'       THEN btrim(col) <> ''
      ELSE NULL
    END;
  END IF;

  -- ---------------- created_at ----------------
  IF fld = 'created_at' THEN
    d1 := public.filter_resolve_day(vtxt);
    IF op = 'between' THEN
      d1 := public.filter_resolve_day(val->>0);
      d2 := public.filter_resolve_day(val->>1);
      IF d1 IS NULL OR d2 IS NULL THEN RETURN NULL; END IF;
      RETURN c.created_at >= d1 AND c.created_at < d2 + interval '1 day';
    END IF;
    IF d1 IS NULL THEN RETURN NULL; END IF;
    RETURN CASE op
      WHEN 'eq'  THEN c.created_at >= d1 AND c.created_at < d1 + interval '1 day'
      WHEN 'neq' THEN NOT (c.created_at >= d1 AND c.created_at < d1 + interval '1 day')
      WHEN 'gt'  THEN c.created_at >= d1 + interval '1 day'
      WHEN 'gte' THEN c.created_at >= d1
      WHEN 'lt'  THEN c.created_at < d1
      WHEN 'lte' THEN c.created_at < d1 + interval '1 day'
      ELSE NULL
    END;
  END IF;

  -- ---------------- tags ----------------
  IF fld = 'tags' THEN
    IF jsonb_typeof(val) <> 'array' THEN RETURN NULL; END IF;
    SELECT array_agg(x::uuid) INTO arr_u
    FROM jsonb_array_elements_text(val) x
    WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    IF arr_u IS NULL THEN RETURN NULL; END IF;
    RETURN CASE op
      WHEN 'has_any'  THEN EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(arr_u))
      WHEN 'has_none' THEN NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(arr_u))
      WHEN 'has_all'  THEN (SELECT count(DISTINCT ct.tag_id) FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(arr_u)) = cardinality(arr_u)
      ELSE NULL
    END;
  END IF;

  -- ---------------- custom fields ----------------
  IF fld LIKE 'cf:%' THEN
    BEGIN
      fid := substr(fld, 4)::uuid;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    SELECT * INTO cf FROM custom_fields
    WHERE id = fid AND account_id = c.account_id AND table_id IS NULL AND archived_at IS NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- generic emptiness
    IF op = 'is_empty' THEN
      RETURN NOT EXISTS (
        SELECT 1 FROM contact_custom_values v
        WHERE v.contact_id = c.id AND v.custom_field_id = fid AND btrim(COALESCE(v.value, '')) <> ''
      );
    ELSIF op = 'is_set' THEN
      RETURN EXISTS (
        SELECT 1 FROM contact_custom_values v
        WHERE v.contact_id = c.id AND v.custom_field_id = fid AND btrim(COALESCE(v.value, '')) <> ''
      );
    END IF;

    IF cf.field_type = 'text' THEN
      RETURN CASE op
        WHEN 'contains' THEN vtxt IS NOT NULL AND vtxt <> '' AND EXISTS (
          SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
            AND v.value ILIKE '%' || replace(replace(replace(vtxt, '\', '\\'), '%', '\%'), '_', '\_') || '%')
        WHEN 'not_contains' THEN vtxt IS NULL OR vtxt = '' OR NOT EXISTS (
          SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
            AND v.value ILIKE '%' || replace(replace(replace(vtxt, '\', '\\'), '%', '\%'), '_', '\_') || '%')
        WHEN 'equals' THEN EXISTS (
          SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
            AND lower(v.value) = lower(COALESCE(vtxt, '')))
        WHEN 'not_equals' THEN NOT EXISTS (
          SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
            AND lower(v.value) = lower(COALESCE(vtxt, '')))
        ELSE NULL
      END;

    ELSIF cf.field_type = 'number' THEN
      IF op = 'between' THEN
        BEGIN
          n1 := (val->>0)::numeric; n2 := (val->>1)::numeric;
        EXCEPTION WHEN others THEN RETURN NULL; END;
        RETURN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
                       AND v.value_number BETWEEN least(n1, n2) AND greatest(n1, n2));
      END IF;
      BEGIN
        n1 := vtxt::numeric;
      EXCEPTION WHEN others THEN RETURN NULL; END;
      RETURN CASE op
        WHEN 'eq'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number = n1)
        WHEN 'neq' THEN NOT EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number = n1)
        WHEN 'gt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number > n1)
        WHEN 'gte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number >= n1)
        WHEN 'lt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number < n1)
        WHEN 'lte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_number <= n1)
        ELSE NULL
      END;

    ELSIF cf.field_type = 'date' THEN
      IF op = 'between' THEN
        d1 := public.filter_resolve_day(val->>0);
        d2 := public.filter_resolve_day(val->>1);
        IF d1 IS NULL OR d2 IS NULL THEN RETURN NULL; END IF;
        RETURN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
                       AND v.value_date >= d1 AND v.value_date < d2 + interval '1 day');
      END IF;
      d1 := public.filter_resolve_day(vtxt);
      IF d1 IS NULL THEN RETURN NULL; END IF;
      RETURN CASE op
        WHEN 'eq'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1 AND v.value_date < d1 + interval '1 day')
        WHEN 'neq' THEN NOT EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1 AND v.value_date < d1 + interval '1 day')
        WHEN 'gt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1 + interval '1 day')
        WHEN 'gte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1)
        WHEN 'lt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date < d1)
        WHEN 'lte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date < d1 + interval '1 day')
        ELSE NULL
      END;

    ELSIF cf.field_type = 'bool' THEN
      RETURN CASE op
        WHEN 'is_true'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_bool IS TRUE)
        WHEN 'is_false' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_bool IS FALSE)
        ELSE NULL
      END;

    ELSIF cf.field_type IN ('enum', 'reference') THEN
      IF op IN ('is', 'is_not') THEN
        arr_t := ARRAY[vtxt];
      ELSIF op IN ('is_any_of', 'is_none_of') AND jsonb_typeof(val) = 'array' THEN
        SELECT array_agg(x) INTO arr_t FROM jsonb_array_elements_text(val) x;
      ELSE
        RETURN NULL;
      END IF;
      IF arr_t IS NULL OR cardinality(arr_t) = 0 THEN RETURN NULL; END IF;
      IF op IN ('is', 'is_any_of') THEN
        RETURN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value = ANY(arr_t));
      END IF;
      RETURN NOT EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value = ANY(arr_t));

    ELSIF cf.field_type = 'multi_enum' THEN
      IF jsonb_typeof(val) <> 'array' THEN RETURN NULL; END IF;
      SELECT array_agg(x) INTO arr_t FROM jsonb_array_elements_text(val) x;
      IF arr_t IS NULL OR cardinality(arr_t) = 0 THEN RETURN NULL; END IF;
      RETURN CASE op
        WHEN 'has_any'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_text_array && arr_t)
        WHEN 'has_all'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_text_array @> arr_t)
        WHEN 'has_none' THEN NOT EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_text_array && arr_t)
        ELSE NULL
      END;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- ------------------------------------------------------------
-- A group (recursive). Skipped rules do not count; an empty group
-- matches everyone. depth is capped so hostile JSON cannot recurse.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_matches_filter(c contacts, filter JSONB, depth INT DEFAULT 0)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  is_or  BOOLEAN := lower(COALESCE(filter->>'op', 'and')) = 'or';
  item   JSONB;
  r      BOOLEAN;
  seen   BOOLEAN := FALSE;
  acc    BOOLEAN;
BEGIN
  IF filter IS NULL OR jsonb_typeof(filter) <> 'object' OR depth > 4 THEN RETURN TRUE; END IF;
  IF jsonb_typeof(filter->'rules') <> 'array' THEN RETURN TRUE; END IF;
  acc := NOT is_or;

  FOR item IN SELECT * FROM jsonb_array_elements(filter->'rules') LOOP
    IF item ? 'rules' THEN
      r := public.contact_matches_filter(c, item, depth + 1);
      -- an empty nested group is "no rule", not "match everyone"
      IF jsonb_typeof(item->'rules') = 'array' AND jsonb_array_length(item->'rules') = 0 THEN
        r := NULL;
      END IF;
    ELSE
      r := public.contact_matches_rule(c, item);
    END IF;
    IF r IS NULL THEN CONTINUE; END IF;
    seen := TRUE;
    IF is_or THEN
      acc := acc OR r;
      IF acc THEN RETURN TRUE; END IF;
    ELSE
      acc := acc AND r;
      IF NOT acc THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;

  IF NOT seen THEN RETURN TRUE; END IF;
  RETURN acc;
END;
$$;

-- ------------------------------------------------------------
-- filter_contacts: paged + sorted + counted
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_filter     JSONB DEFAULT NULL,
  p_search     TEXT DEFAULT NULL,
  p_limit      INT DEFAULT 25,
  p_offset     INT DEFAULT 0,
  p_sort_field TEXT DEFAULT NULL,
  p_sort_dir   TEXT DEFAULT 'desc',
  p_account_id UUID DEFAULT NULL
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  sort_fid  UUID;
  sort_type TEXT;
  is_asc    BOOLEAN := lower(COALESCE(p_sort_dir, 'desc')) = 'asc';
  safe_search TEXT := NULLIF(btrim(p_search), '');
BEGIN
  IF p_sort_field LIKE 'cf:%' THEN
    BEGIN
      sort_fid := substr(p_sort_field, 4)::uuid;
      SELECT field_type INTO sort_type FROM custom_fields
      WHERE id = sort_fid AND table_id IS NULL AND archived_at IS NULL;
    EXCEPTION WHEN others THEN
      sort_fid := NULL;
    END;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT c.*
    FROM contacts c
    WHERE (p_account_id IS NULL OR c.account_id = p_account_id)
      AND public.contact_matches_filter(c, p_filter)
      AND (
        safe_search IS NULL
        OR c.name  ILIKE '%' || safe_search || '%'
        OR c.phone ILIKE '%' || safe_search || '%'
        OR c.email ILIKE '%' || safe_search || '%'
      )
  ),
  keyed AS (
    SELECT m.id,
           v.value        AS s_text,
           v.value_number AS s_num,
           v.value_date   AS s_date,
           m.created_at   AS s_created,
           m.name         AS s_name
    FROM matched m
    LEFT JOIN contact_custom_values v
      ON sort_fid IS NOT NULL AND v.contact_id = m.id AND v.custom_field_id = sort_fid
  ),
  page AS (
    SELECT k.id,
           count(*) OVER () AS total_count,
           row_number() OVER (
             ORDER BY
               CASE WHEN is_asc THEN CASE WHEN p_sort_field = 'name' THEN lower(k.s_name) END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN p_sort_field = 'name' THEN lower(k.s_name) END END DESC NULLS LAST,
               CASE WHEN is_asc THEN CASE WHEN sort_type = 'number' THEN k.s_num END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN sort_type = 'number' THEN k.s_num END END DESC NULLS LAST,
               CASE WHEN is_asc THEN CASE WHEN sort_type = 'date' THEN k.s_date END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN sort_type = 'date' THEN k.s_date END END DESC NULLS LAST,
               CASE WHEN is_asc THEN CASE WHEN sort_type IN ('text', 'enum', 'bool', 'multi_enum', 'reference') THEN lower(k.s_text) END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN sort_type IN ('text', 'enum', 'bool', 'multi_enum', 'reference') THEN lower(k.s_text) END END DESC NULLS LAST,
               k.s_created DESC,
               k.id
           ) AS rn
    FROM keyed k
    ORDER BY rn
    LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY page.rn;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_contacts(
  p_filter JSONB DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_account_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)
  FROM contacts c
  WHERE (p_account_id IS NULL OR c.account_id = p_account_id)
    AND public.contact_matches_filter(c, p_filter)
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR c.name  ILIKE '%' || btrim(p_search) || '%'
      OR c.phone ILIKE '%' || btrim(p_search) || '%'
      OR c.email ILIKE '%' || btrim(p_search) || '%'
    );
$$;

ALTER FUNCTION public.filter_resolve_day(TEXT) OWNER TO postgres;
ALTER FUNCTION public.contact_matches_rule(contacts, JSONB) OWNER TO postgres;
ALTER FUNCTION public.contact_matches_filter(contacts, JSONB, INT) OWNER TO postgres;
ALTER FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) OWNER TO postgres;
ALTER FUNCTION public.count_contacts(JSONB, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_resolve_day(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_matches_rule(contacts, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_matches_filter(contacts, JSONB, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_contacts(JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_resolve_day(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_matches_rule(contacts, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_matches_filter(contacts, JSONB, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_contacts(JSONB, TEXT, UUID) TO authenticated, service_role;
