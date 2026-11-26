-- ============================================================
-- 099_contact_wa_status.sql
--
-- Passive WhatsApp reachability, from what Meta already tells us (no lookup service):
--   active      the number messaged us, or a message to it was delivered / read
--   unreachable a send failed with Meta error 131026 ("unable to deliver": not on
--               WhatsApp, has not accepted new terms, or a very old app)
--   NULL        never seen either way
-- A later inbound / delivered message flips 'unreachable' back to 'active'.
--
-- Also: accounts.broadcast_skip_unreachable (the broadcast switch), and the segment / filter rule field 'wa_unreachable' (is_true / is_false).
-- contact_matches_rule body copied from 077 plus that one block.
-- Idempotent.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_status        TEXT,
  ADD COLUMN IF NOT EXISTS wa_status_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wa_status_source TEXT;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_wa_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_wa_status_check
  CHECK (wa_status IS NULL OR wa_status IN ('active', 'unreachable'));

-- Account switch: leave unreachable numbers out of broadcasts (off by default).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS broadcast_skip_unreachable BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_wa_unreachable
  ON contacts(account_id) WHERE wa_status = 'unreachable';

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
  IF fld IN ('name', 'phone', 'email', 'company', 'lead_source', 'utm_source', 'utm_medium',
             'utm_campaign', 'utm_term', 'utm_content', 'source_referrer') THEN
    col := CASE fld
             WHEN 'name' THEN COALESCE(c.name, '')
             WHEN 'phone' THEN COALESCE(c.phone, '')
             WHEN 'email' THEN COALESCE(c.email, '')
             WHEN 'company' THEN COALESCE(c.company, '')
             WHEN 'lead_source' THEN COALESCE(c.lead_source, '')
             WHEN 'utm_source' THEN COALESCE(c.utm_source, '')
             WHEN 'utm_medium' THEN COALESCE(c.utm_medium, '')
             WHEN 'utm_campaign' THEN COALESCE(c.utm_campaign, '')
             WHEN 'utm_term' THEN COALESCE(c.utm_term, '')
             WHEN 'utm_content' THEN COALESCE(c.utm_content, '')
             ELSE COALESCE(c.source_referrer, '')
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

  -- ---------------- blocked (is_true / is_false) ----------------
  IF fld = 'blocked' THEN
    IF op = 'is_true' THEN RETURN c.blocked_at IS NOT NULL; END IF;
    IF op = 'is_false' THEN RETURN c.blocked_at IS NULL; END IF;
    RETURN NULL;
  END IF;

  -- ---------------- unreachable on WhatsApp (is_true / is_false) ----------------
  IF fld = 'wa_unreachable' THEN
    IF op = 'is_true' THEN RETURN c.wa_status = 'unreachable'; END IF;
    IF op = 'is_false' THEN RETURN c.wa_status IS DISTINCT FROM 'unreachable'; END IF;
    RETURN NULL;
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

ALTER FUNCTION public.contact_matches_rule(contacts, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contact_matches_rule(contacts, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_matches_rule(contacts, JSONB) TO authenticated, service_role;
