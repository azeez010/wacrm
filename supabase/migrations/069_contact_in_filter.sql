-- ============================================================
-- 069_contact_in_filter.sql
--
-- contact_in_filter(): does ONE contact match a FilterGroup? Used by the
-- automation engine's "In segment" condition (service role, so the
-- account id is a required, explicit guard). Same evaluator as
-- filter_contacts (067). Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contact_in_filter(
  p_contact_id UUID,
  p_account_id UUID,
  p_filter     JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contacts c
    WHERE c.id = p_contact_id
      AND c.account_id = p_account_id
      AND public.contact_matches_filter(c, p_filter)
  );
$$;

ALTER FUNCTION public.contact_in_filter(UUID, UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contact_in_filter(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_in_filter(UUID, UUID, JSONB) TO authenticated, service_role;
