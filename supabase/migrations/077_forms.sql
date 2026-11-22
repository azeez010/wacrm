-- 077: Forms (lead capture) + built-in lead source fields on contacts.
--
--  * forms / form_submissions / form_events
--  * contacts: lead_source, utm_*, source_referrer, source_form_id, first_seen_at
--    (first-touch, filled once) and opt-in proof (opt_in_*)
--  * contact_matches_rule: the new text columns are filterable like name/email
--  * form_stats(): funnel + breakdowns for the Results screen
--  * count_form_submissions(): monthly quota meter
--  * notifications.type gains 'form_submission'

-- ------------------------------------------------------------
-- forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Unguessable, non-secret id used in public URLs (/f/<public_id>).
  public_id   TEXT NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  kind        TEXT NOT NULL DEFAULT 'lead' CHECK (kind IN ('lead', 'support')),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INT NOT NULL DEFAULT 1,
  rr_cursor   INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT forms_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_forms_public_id ON forms(public_id);
CREATE INDEX IF NOT EXISTS idx_forms_account ON forms(account_id) WHERE archived_at IS NULL;

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS forms_select ON forms;
DROP POLICY IF EXISTS forms_insert ON forms;
DROP POLICY IF EXISTS forms_update ON forms;
DROP POLICY IF EXISTS forms_delete ON forms;
CREATE POLICY forms_select ON forms FOR SELECT USING (is_account_member(account_id));
CREATE POLICY forms_insert ON forms FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY forms_update ON forms FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY forms_delete ON forms FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON forms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- contacts: built-in lead source + opt-in proof
-- ------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_source     TEXT,
  ADD COLUMN IF NOT EXISTS utm_source      TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium      TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign    TEXT,
  ADD COLUMN IF NOT EXISTS utm_term        TEXT,
  ADD COLUMN IF NOT EXISTS utm_content     TEXT,
  ADD COLUMN IF NOT EXISTS source_referrer TEXT,
  ADD COLUMN IF NOT EXISTS source_form_id  UUID REFERENCES forms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_seen_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_in_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_in_source   TEXT,
  ADD COLUMN IF NOT EXISTS opt_in_text     TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_source_form
  ON contacts(source_form_id) WHERE source_form_id IS NOT NULL;

-- ------------------------------------------------------------
-- form_submissions (service-role writes, members read)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  form_version  INT NOT NULL DEFAULT 1,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  -- { "<field id>": { "label": "...", "value": ... } }: labels are snapshotted
  -- so old submissions stay readable after the form is edited.
  answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
  score         INT NOT NULL DEFAULT 0,
  qualified     BOOLEAN,
  outcome       TEXT NOT NULL DEFAULT 'accepted'
                CHECK (outcome IN ('accepted', 'held', 'blocked', 'rejected', 'spam')),
  reject_reason TEXT,
  is_test       BOOLEAN NOT NULL DEFAULT FALSE,
  is_repeat     BOOLEAN NOT NULL DEFAULT FALSE,
  consent       JSONB,
  utm           JSONB NOT NULL DEFAULT '{}'::jsonb,
  click_ids     JSONB NOT NULL DEFAULT '{}'::jsonb,
  referrer      TEXT,
  page_url      TEXT,
  country       TEXT,
  device        TEXT,
  visitor_id    TEXT,
  ip_hash       TEXT,
  -- Per-step result of the post-submit pipeline, so failed steps can be retried.
  processing    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_created ON form_submissions(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_account_month ON form_submissions(account_id, created_at)
  WHERE is_test = FALSE;
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON form_submissions(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS form_submissions_select ON form_submissions;
DROP POLICY IF EXISTS form_submissions_update ON form_submissions;
DROP POLICY IF EXISTS form_submissions_delete ON form_submissions;
CREATE POLICY form_submissions_select ON form_submissions FOR SELECT USING (is_account_member(account_id));
CREATE POLICY form_submissions_update ON form_submissions FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY form_submissions_delete ON form_submissions FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- form_events (service role only: no policies = no client access)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  form_id    UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('view', 'start', 'attempt')),
  is_test    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_events_form_created ON form_events(form_id, created_at DESC);
ALTER TABLE form_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- notifications: new type
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'form_submission'));

-- ------------------------------------------------------------
-- Quota meter: accepted / held counts this month (service role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_form_submissions(p_account UUID, p_since TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'accepted', count(*) FILTER (WHERE outcome = 'accepted'),
    'held',     count(*) FILTER (WHERE outcome = 'held')
  )
  FROM form_submissions
  WHERE account_id = p_account AND is_test = FALSE AND created_at >= p_since;
$$;

-- ------------------------------------------------------------
-- Results screen: funnel + breakdowns in one call. Membership-checked.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.form_stats(p_form_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_visited INT; v_started INT; v_attempted INT; v_submitted INT; v_qualified INT; v_blocked INT;
BEGIN
  SELECT account_id INTO v_account FROM forms WHERE id = p_form_id;
  IF v_account IS NULL OR NOT public.is_account_member(v_account) THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT visitor_id) INTO v_visited FROM form_events
   WHERE form_id = p_form_id AND type = 'view' AND NOT is_test AND created_at >= p_from AND created_at < p_to;
  SELECT count(DISTINCT visitor_id) INTO v_started FROM form_events
   WHERE form_id = p_form_id AND type IN ('start', 'attempt') AND NOT is_test AND created_at >= p_from AND created_at < p_to;
  SELECT count(DISTINCT visitor_id) INTO v_attempted FROM form_events
   WHERE form_id = p_form_id AND type = 'attempt' AND NOT is_test AND created_at >= p_from AND created_at < p_to;
  SELECT count(*) FILTER (WHERE outcome IN ('accepted', 'held')),
         count(*) FILTER (WHERE outcome = 'accepted' AND qualified IS TRUE),
         count(*) FILTER (WHERE outcome = 'blocked')
    INTO v_submitted, v_qualified, v_blocked
    FROM form_submissions
   WHERE form_id = p_form_id AND NOT is_test AND created_at >= p_from AND created_at < p_to;

  RETURN jsonb_build_object(
    'visited', v_visited,
    'started', v_started,
    'attempted', GREATEST(v_attempted, v_submitted),
    'submitted', v_submitted,
    'qualified', v_qualified,
    'blocked', v_blocked,
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(NULLIF(utm->>'source', ''), '(direct)') AS k, count(*) AS n
              FROM form_submissions
             WHERE form_id = p_form_id AND NOT is_test AND outcome IN ('accepted', 'held')
               AND created_at >= p_from AND created_at < p_to
             GROUP BY 1 ORDER BY 2 DESC LIMIT 20) s), '[]'::jsonb),
    'by_campaign', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(NULLIF(utm->>'campaign', ''), '(none)') AS k, count(*) AS n
              FROM form_submissions
             WHERE form_id = p_form_id AND NOT is_test AND outcome IN ('accepted', 'held')
               AND created_at >= p_from AND created_at < p_to
             GROUP BY 1 ORDER BY 2 DESC LIMIT 20) s), '[]'::jsonb),
    'by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(NULLIF(country, ''), '(unknown)') AS k, count(*) AS n
              FROM form_submissions
             WHERE form_id = p_form_id AND NOT is_test AND outcome IN ('accepted', 'held')
               AND created_at >= p_from AND created_at < p_to
             GROUP BY 1 ORDER BY 2 DESC LIMIT 20) s), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d, 'views', v, 'submissions', s) ORDER BY d)
      FROM (
        SELECT day::date AS d,
               (SELECT count(DISTINCT visitor_id) FROM form_events e
                 WHERE e.form_id = p_form_id AND e.type = 'view' AND NOT e.is_test
                   AND e.created_at >= day AND e.created_at < day + interval '1 day') AS v,
               (SELECT count(*) FROM form_submissions f
                 WHERE f.form_id = p_form_id AND NOT f.is_test AND f.outcome IN ('accepted', 'held')
                   AND f.created_at >= day AND f.created_at < day + interval '1 day') AS s
          FROM generate_series(date_trunc('day', p_from), date_trunc('day', p_to - interval '1 second'), interval '1 day') AS day
      ) t), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.count_form_submissions(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_form_submissions(UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.form_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.form_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Filtering: the source columns behave like name / email / company.
-- Body copied from 076 with the extended built-in text set.
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


-- ------------------------------------------------------------
-- redeem_invitation: forms (and their leads) also count as "has data".
-- Body identical to 068 plus the three form tables.
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
