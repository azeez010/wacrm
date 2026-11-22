-- ============================================================
-- 074_more_field_types.sql
--
--   * New custom field types: url, phone, email, datetime.
--     - url / email / phone filter and sort like text.
--     - datetime filters and sorts like a date field with time (always an
--       instant, day boundaries in the account time zone).
--   * contact_column_values(): everything the Contacts table needs for its
--     custom columns in ONE round trip: each value plus, for reference
--     fields, the referenced row's label and full data (so custom-table
--     sub-columns need no extra query).
-- Idempotent.
-- ============================================================

ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_type_check;
ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_type_check
  CHECK (field_type IN
    ('text', 'number', 'bool', 'date', 'enum', 'multi_enum', 'reference', 'media',
     'url', 'phone', 'email', 'datetime'));

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
  tz    TEXT;
  inst  BOOLEAN;
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
    inst := TRUE;
    SELECT COALESCE(a.timezone, 'UTC') INTO tz FROM accounts a WHERE a.id = c.account_id;
    d1 := public.filter_resolve_day(vtxt, tz, inst);
    IF op = 'between' THEN
      d1 := public.filter_resolve_day(val->>0, tz, inst);
      d2 := public.filter_resolve_day(val->>1, tz, inst);
      IF d1 IS NULL OR d2 IS NULL THEN RETURN NULL; END IF;
      RETURN c.created_at >= d1 AND c.created_at < public.filter_day_end(d2, tz, inst);
    END IF;
    IF d1 IS NULL THEN RETURN NULL; END IF;
    RETURN CASE op
      WHEN 'eq'  THEN c.created_at >= d1 AND c.created_at < public.filter_day_end(d1, tz, inst)
      WHEN 'neq' THEN NOT (c.created_at >= d1 AND c.created_at < public.filter_day_end(d1, tz, inst))
      WHEN 'gt'  THEN c.created_at >= public.filter_day_end(d1, tz, inst)
      WHEN 'gte' THEN c.created_at >= d1
      WHEN 'lt'  THEN c.created_at < d1
      WHEN 'lte' THEN c.created_at < public.filter_day_end(d1, tz, inst)
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

    IF cf.field_type IN ('text', 'url', 'email', 'phone') THEN
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

    ELSIF cf.field_type IN ('date', 'datetime') THEN
      inst := cf.field_type = 'datetime' OR COALESCE(cf.field_options->>'include_time', 'false') = 'true';
      SELECT COALESCE(a.timezone, 'UTC') INTO tz FROM accounts a WHERE a.id = c.account_id;
      IF op = 'between' THEN
        d1 := public.filter_resolve_day(val->>0, tz, inst);
        d2 := public.filter_resolve_day(val->>1, tz, inst);
        IF d1 IS NULL OR d2 IS NULL THEN RETURN NULL; END IF;
        RETURN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid
                       AND v.value_date >= d1 AND v.value_date < public.filter_day_end(d2, tz, inst));
      END IF;
      d1 := public.filter_resolve_day(vtxt, tz, inst);
      IF d1 IS NULL THEN RETURN NULL; END IF;
      RETURN CASE op
        WHEN 'eq'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1 AND v.value_date < public.filter_day_end(d1, tz, inst))
        WHEN 'neq' THEN NOT EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1 AND v.value_date < public.filter_day_end(d1, tz, inst))
        WHEN 'gt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= public.filter_day_end(d1, tz, inst))
        WHEN 'gte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date >= d1)
        WHEN 'lt'  THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date < d1)
        WHEN 'lte' THEN EXISTS (SELECT 1 FROM contact_custom_values v WHERE v.contact_id = c.id AND v.custom_field_id = fid AND v.value_date < public.filter_day_end(d1, tz, inst))
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
               CASE WHEN is_asc THEN CASE WHEN sort_type IN ('date', 'datetime') THEN k.s_date END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN sort_type IN ('date', 'datetime') THEN k.s_date END END DESC NULLS LAST,
               CASE WHEN is_asc THEN CASE WHEN sort_type IN ('text', 'enum', 'bool', 'multi_enum', 'reference', 'url', 'email', 'phone') THEN lower(k.s_text) END END ASC NULLS LAST,
               CASE WHEN NOT is_asc THEN CASE WHEN sort_type IN ('text', 'enum', 'bool', 'multi_enum', 'reference', 'url', 'email', 'phone') THEN lower(k.s_text) END END DESC NULLS LAST,
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

ALTER FUNCTION public.contact_matches_rule(contacts, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contact_matches_rule(contacts, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_matches_rule(contacts, JSONB) TO authenticated, service_role;

ALTER FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(JSONB, TEXT, INT, INT, TEXT, TEXT, UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- One-trip custom column values (SECURITY INVOKER: RLS still applies, so
-- fields hidden from viewers and other accounts' rows never come back).
-- The CASE keeps a non-uuid value from raising a cast error.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_column_values(
  p_contact_ids UUID[],
  p_field_ids   UUID[]
)
RETURNS TABLE (
  contact_id      UUID,
  custom_field_id UUID,
  value           TEXT,
  ref_label       TEXT,
  ref_data        JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT v.contact_id, v.custom_field_id, v.value, r.label, r.data
  FROM contact_custom_values v
  JOIN custom_fields f ON f.id = v.custom_field_id
  LEFT JOIN custom_records r
    ON f.field_type = 'reference'
   AND r.id = (CASE WHEN v.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN v.value::uuid END)
  WHERE v.contact_id = ANY(p_contact_ids)
    AND v.custom_field_id = ANY(p_field_ids);
$$;

ALTER FUNCTION public.contact_column_values(UUID[], UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contact_column_values(UUID[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_column_values(UUID[], UUID[]) TO authenticated, service_role;
