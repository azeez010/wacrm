-- ============================================================
-- 071_account_timezone.sql
--
-- Account time zone (Settings, Account, Time zone). Relative date tokens in
-- filters ('today', '-7d', '+30d') and the day boundaries of date
-- comparisons now resolve in the account's zone instead of UTC.
--
-- Two kinds of date values:
--   * calendar-day values (date fields without time): stored as UTC
--     midnight of the calendar day, so the token resolves to a LOCAL
--     calendar date and is then compared as UTC midnight of that date.
--   * instants (created_at, date fields with include_time): the day runs
--     from local midnight to the next local midnight (DST-safe).
-- Idempotent.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_timezone_valid') THEN
    -- pg_timezone_names is a view, so validity is checked by trying the zone.
    ALTER TABLE accounts ADD CONSTRAINT accounts_timezone_valid
      CHECK (length(timezone) BETWEEN 1 AND 64 AND timezone ~ '^[A-Za-z0-9_+/-]+$');
  END IF;
END $$;

-- Old 1-arg helper stays callable (UTC); the rule evaluator uses the new one.
DROP FUNCTION IF EXISTS public.filter_resolve_day(TEXT);

CREATE OR REPLACE FUNCTION public.filter_resolve_day(
  p_value   TEXT,
  p_tz      TEXT DEFAULT 'UTC',
  p_instant BOOLEAN DEFAULT FALSE
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v     TEXT := lower(btrim(COALESCE(p_value, '')));
  tz    TEXT := COALESCE(NULLIF(btrim(p_tz), ''), 'UTC');
  today DATE;
  d     DATE;
  m     TEXT[];
  n     INT;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  today := (now() AT TIME ZONE tz)::date;

  IF v = 'today' THEN d := today;
  ELSIF v = 'yesterday' THEN d := today - 1;
  ELSIF v = 'tomorrow' THEN d := today + 1;
  ELSE
    m := regexp_match(v, '^([+-])(\d{1,5})([dwmy])$');
    IF m IS NOT NULL THEN
      n := (CASE m[1] WHEN '-' THEN -1 ELSE 1 END) * m[2]::int;
      d := (CASE m[3]
              WHEN 'd' THEN today + n
              WHEN 'w' THEN today + n * 7
              WHEN 'm' THEN (today + make_interval(months => n))::date
              ELSE (today + make_interval(years => n))::date
            END);
    ELSIF v ~ '^\d{4}-\d{2}-\d{2}$' THEN
      d := v::date;
    ELSE
      d := (v::timestamptz AT TIME ZONE tz)::date;
    END IF;
  END IF;

  IF p_instant THEN
    RETURN d::timestamp AT TIME ZONE tz;
  END IF;
  RETURN d::timestamp AT TIME ZONE 'UTC';
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- End of the day that starts at p_start (exclusive upper bound).
CREATE OR REPLACE FUNCTION public.filter_day_end(
  p_start   TIMESTAMPTZ,
  p_tz      TEXT DEFAULT 'UTC',
  p_instant BOOLEAN DEFAULT FALSE
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_instant THEN (((p_start AT TIME ZONE COALESCE(NULLIF(btrim(p_tz), ''), 'UTC'))::date + 1)::timestamp
                         AT TIME ZONE COALESCE(NULLIF(btrim(p_tz), ''), 'UTC'))
    ELSE p_start + interval '1 day'
  END;
$$;

ALTER FUNCTION public.filter_resolve_day(TEXT, TEXT, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public.filter_day_end(TIMESTAMPTZ, TEXT, BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_resolve_day(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.filter_day_end(TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_resolve_day(TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.filter_day_end(TIMESTAMPTZ, TEXT, BOOLEAN) TO authenticated, service_role;

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
      inst := COALESCE(cf.field_options->>'include_time', 'false') = 'true';
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

ALTER FUNCTION public.contact_matches_rule(contacts, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contact_matches_rule(contacts, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_matches_rule(contacts, JSONB) TO authenticated, service_role;
