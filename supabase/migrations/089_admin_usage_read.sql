-- ============================================================
-- 089_admin_usage_read.sql
--
-- Lets the admin API role (see 088) show per-business usage on the console:
-- the contact count and this month's billable message count. Read-only.
--  * SELECT on contacts (RLS policy scoped to ogadesk_admin_api only)
--  * EXECUTE on count_billable_messages (073 granted it to service_role only)
-- Idempotent.
-- ============================================================

GRANT SELECT ON public.contacts TO ogadesk_admin_api;

DROP POLICY IF EXISTS admin_api_read ON public.contacts;
CREATE POLICY admin_api_read ON public.contacts
  FOR SELECT TO ogadesk_admin_api USING (true);

GRANT EXECUTE ON FUNCTION public.count_billable_messages(UUID, TIMESTAMPTZ) TO ogadesk_admin_api;
