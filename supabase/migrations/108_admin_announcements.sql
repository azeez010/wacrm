-- ============================================================
-- 108_admin_announcements.sql
-- Announcements written in the admin console.
--   kind 'in_app'   banner inside the dashboard, for every business or a frozen list of businesses
--                   (the audience filters are evaluated once, at publish, into announcement_targets)
--   kind 'landing'  banner on the public site (served by the admin API's public endpoint, not by this DB function)
-- title/body/link_label are {locale: text} maps; 'en' is required and is the fallback.
--   public.active_announcements(account)  what a signed-in member of that business should see right now.
--                                         Never returns the audience filters, targets or who wrote it.
-- Idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin.announcements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('in_app', 'landing')),
  severity      text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  title         jsonb NOT NULL CHECK (jsonb_typeof(title) = 'object' AND title ? 'en'),
  body          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  link_url      text CHECK (link_url IS NULL OR link_url ~ '^(https://|/)'),
  link_label    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(link_label) = 'object'),
  starts_at     timestamptz,
  ends_at       timestamptz,
  dismissible   boolean NOT NULL DEFAULT true,
  owners_only   boolean NOT NULL DEFAULT false,
  audience_all  boolean NOT NULL DEFAULT true,
  audience      jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_count  integer,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
  created_by    uuid REFERENCES admin.admin_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  ended_at      timestamptz,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS announcements_live_idx ON admin.announcements (kind, status) WHERE status = 'live';

CREATE TABLE IF NOT EXISTS admin.announcement_targets (
  announcement_id uuid NOT NULL REFERENCES admin.announcements(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, account_id)
);
CREATE INDEX IF NOT EXISTS announcement_targets_account_idx ON admin.announcement_targets (account_id);

ALTER TABLE admin.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.announcement_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.announcements, admin.announcement_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.announcements, admin.announcement_targets TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.announcements;
CREATE POLICY admin_api_all ON admin.announcements FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS admin_api_all ON admin.announcement_targets;
CREATE POLICY admin_api_all ON admin.announcement_targets FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.active_announcements(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
DECLARE
  v_role text;
BEGIN
  -- Only members of the business, and only for themselves.
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT account_role::text INTO v_role FROM profiles WHERE user_id = auth.uid() AND account_id = p_account;
  IF v_role IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'severity', a.severity, 'title', a.title, 'body', a.body,
             'linkUrl', a.link_url, 'linkLabel', a.link_label, 'dismissible', a.dismissible)
           ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.published_at DESC)
      FROM admin.announcements a
     WHERE a.kind = 'in_app' AND a.status = 'live'
       AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at > now())
       AND (NOT a.owners_only OR v_role IN ('owner', 'admin'))
       AND (a.audience_all OR EXISTS (SELECT 1 FROM admin.announcement_targets t WHERE t.announcement_id = a.id AND t.account_id = p_account))
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.active_announcements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_announcements(uuid) TO authenticated;
