-- ============================================================
-- 101_admin_usage_by_account.sql
--
-- Per-business product usage for the admin console ("is this business actually using
-- OgaDesk?"). One SECURITY DEFINER function, counts / dates only: never message text,
-- phone numbers, names of contacts, tokens or keys. EXECUTE only for ogadesk_admin_api.
--
--   admin.usage_by_account(p_days, p_account)
--     p_days     window for the volume metrics (clamped 7..90); engagement ignores it
--     p_account  optional: restrict to one business (cheap detail lookup)
--
-- Engagement (computed here once so the usage page, the dashboard and announcement
-- audiences all agree):
--   onboarding       signed up < 7 days ago
--   never_activated  >= 7 days old with no WhatsApp number, no conversation and no active form
--   active           last activity <= 14 days ago
--   slowing          15..45 days
--   dormant          > 45 days
-- Last activity = greatest of: last message, last dashboard presence, last contact,
-- last form lead, API-key use, automation/flow run, AI call (falls back to signup date).
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION admin.usage_by_account(p_days integer DEFAULT 30, p_account uuid DEFAULT NULL)
RETURNS TABLE (
  account_id uuid, name text, created_at timestamptz, owner_email text,
  plan_id text, subscription_status text, current_period_end timestamptz,
  onboarded_at timestamptz, use_cases jsonb, heard_from text,
  contacts_total integer, contacts_new integer, contacts_last_at timestamptz,
  conversations_total integer, web_chat_conversations integer,
  msgs_in integer, msgs_out integer, msgs_template integer, msgs_delivered integer, msgs_read integer, msgs_failed integer,
  last_message_at timestamptz,
  wa_total integer, wa_connected integer,
  forms_active integer, form_views integer, form_leads integer, form_conversion numeric, form_last_lead_at timestamptz,
  deals_open integer, deals_won integer,
  automations_active integer, automation_runs integer, automation_last_at timestamptz,
  flows_active integer, flow_runs integer, flow_last_at timestamptz,
  broadcasts_sent integer, broadcast_delivered integer, broadcast_replied integer,
  templates_approved integer, quick_replies integer, segments integer, custom_tables integer, custom_records integer,
  members integer, members_admin integer, invites_pending integer, invites_accepted integer, last_seen_at timestamptz,
  ai_calls integer, ai_tokens bigint, ai_last_at timestamptz,
  api_keys_active integer, api_key_last_used_at timestamptz,
  webhooks_active integer, webhook_last_at timestamptz,
  last_activity_at timestamptz, days_since_activity integer, engagement text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH w AS (SELECT now() - make_interval(days => greatest(7, least(coalesce(p_days, 30), 90))) AS since),
  ct AS (
    SELECT account_id, count(*)::int AS total, (count(*) FILTER (WHERE created_at >= (SELECT since FROM w)))::int AS fresh, max(created_at) AS last_at
      FROM contacts WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  cv AS (
    SELECT account_id, count(*)::int AS total, (count(*) FILTER (WHERE channel = 'web_chat'))::int AS web, max(last_message_at) AS last_msg
      FROM conversations WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  ms AS (
    SELECT c.account_id,
           (count(*) FILTER (WHERE m.sender_type = 'customer'))::int AS msgs_in,
           (count(*) FILTER (WHERE m.sender_type <> 'customer'))::int AS msgs_out,
           (count(*) FILTER (WHERE m.sender_type <> 'customer' AND m.content_type = 'template'))::int AS tpl,
           (count(*) FILTER (WHERE m.sender_type <> 'customer' AND m.status = 'delivered'))::int AS delivered,
           (count(*) FILTER (WHERE m.sender_type <> 'customer' AND m.status = 'read'))::int AS read,
           (count(*) FILTER (WHERE m.sender_type <> 'customer' AND m.status = 'failed'))::int AS failed
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.created_at >= (SELECT since FROM w) AND m.content_type <> 'event'
       AND (p_account IS NULL OR c.account_id = p_account)
     GROUP BY c.account_id
  ),
  wa AS (
    SELECT account_id, count(*)::int AS total, (count(*) FILTER (WHERE status = 'connected'))::int AS connected
      FROM whatsapp_config WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  fm AS (
    SELECT account_id,
           (count(*) FILTER (WHERE status = 'active' AND archived_at IS NULL))::int AS active,
           coalesce(sum((stats_cache->>'views')::numeric) FILTER (WHERE archived_at IS NULL), 0)::int AS views,
           coalesce(sum((stats_cache->>'leads')::numeric) FILTER (WHERE archived_at IS NULL), 0)::int AS leads,
           max((stats_cache->>'last_lead_at')::timestamptz) AS last_lead
      FROM forms WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  dl AS (
    SELECT account_id, (count(*) FILTER (WHERE status = 'open'))::int AS open, (count(*) FILTER (WHERE status = 'won'))::int AS won
      FROM deals WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  au AS (
    SELECT account_id, (count(*) FILTER (WHERE is_active))::int AS active, coalesce(sum(execution_count), 0)::int AS runs, max(last_executed_at) AS last_at
      FROM automations WHERE system_key IS NULL AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id
  ),
  fl AS (
    SELECT account_id, (count(*) FILTER (WHERE status = 'active'))::int AS active, coalesce(sum(execution_count), 0)::int AS runs, max(last_executed_at) AS last_at
      FROM flows WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  bc AS (
    SELECT account_id, (count(*) FILTER (WHERE status IN ('sending', 'sent')))::int AS sent,
           coalesce(sum(delivered_count), 0)::int AS delivered, coalesce(sum(replied_count), 0)::int AS replied
      FROM broadcasts WHERE created_at >= (SELECT since FROM w) AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id
  ),
  tp AS (SELECT account_id, count(*)::int AS n FROM message_templates WHERE upper(status) = 'APPROVED' AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id),
  qr AS (SELECT account_id, count(*)::int AS n FROM quick_replies WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id),
  sg AS (SELECT account_id, count(*)::int AS n FROM segments WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id),
  ctb AS (SELECT account_id, count(*)::int AS n FROM custom_tables WHERE archived_at IS NULL AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id),
  crc AS (SELECT account_id, count(*)::int AS n FROM custom_records WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id),
  mb AS (
    SELECT account_id, count(*)::int AS n, (count(*) FILTER (WHERE account_role::text IN ('owner', 'admin')))::int AS admins
      FROM profiles WHERE account_id IS NOT NULL AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id
  ),
  inv AS (
    SELECT account_id, (count(*) FILTER (WHERE accepted_at IS NULL AND expires_at > now()))::int AS pending, (count(*) FILTER (WHERE accepted_at IS NOT NULL))::int AS accepted
      FROM account_invitations WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  pr AS (SELECT account_id, max(last_seen_at) AS last_seen FROM member_presence WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id),
  ai AS (
    SELECT account_id, count(*)::int AS calls, coalesce(sum(total_tokens), 0)::bigint AS tokens, max(created_at) AS last_at
      FROM ai_usage_log WHERE created_at >= (SELECT since FROM w) AND (p_account IS NULL OR account_id = p_account) GROUP BY account_id
  ),
  ak AS (
    SELECT account_id, (count(*) FILTER (WHERE revoked_at IS NULL))::int AS active, max(last_used_at) AS last_used
      FROM api_keys WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  wh AS (
    SELECT account_id, (count(*) FILTER (WHERE is_active))::int AS active, max(last_delivery_at) AS last_at
      FROM webhook_endpoints WHERE p_account IS NULL OR account_id = p_account GROUP BY account_id
  ),
  base AS (
    SELECT a.id AS account_id, a.name, a.created_at, o.email AS owner_email,
           coalesce(s.plan_id, 'free') AS plan_id, s.status AS subscription_status, s.current_period_end,
           a.onboarded_at, to_jsonb(a.use_cases) AS use_cases, a.heard_from,
           coalesce(ct.total, 0) AS contacts_total, coalesce(ct.fresh, 0) AS contacts_new, ct.last_at AS contacts_last_at,
           coalesce(cv.total, 0) AS conversations_total, coalesce(cv.web, 0) AS web_chat_conversations,
           coalesce(ms.msgs_in, 0) AS msgs_in, coalesce(ms.msgs_out, 0) AS msgs_out, coalesce(ms.tpl, 0) AS msgs_template,
           coalesce(ms.delivered, 0) AS msgs_delivered, coalesce(ms.read, 0) AS msgs_read, coalesce(ms.failed, 0) AS msgs_failed,
           cv.last_msg AS last_message_at,
           coalesce(wa.total, 0) AS wa_total, coalesce(wa.connected, 0) AS wa_connected,
           coalesce(fm.active, 0) AS forms_active, coalesce(fm.views, 0) AS form_views, coalesce(fm.leads, 0) AS form_leads,
           CASE WHEN coalesce(fm.views, 0) > 0 THEN round(fm.leads::numeric * 100 / fm.views, 1) END AS form_conversion,
           fm.last_lead AS form_last_lead_at,
           coalesce(dl.open, 0) AS deals_open, coalesce(dl.won, 0) AS deals_won,
           coalesce(au.active, 0) AS automations_active, coalesce(au.runs, 0) AS automation_runs, au.last_at AS automation_last_at,
           coalesce(fl.active, 0) AS flows_active, coalesce(fl.runs, 0) AS flow_runs, fl.last_at AS flow_last_at,
           coalesce(bc.sent, 0) AS broadcasts_sent, coalesce(bc.delivered, 0) AS broadcast_delivered, coalesce(bc.replied, 0) AS broadcast_replied,
           coalesce(tp.n, 0) AS templates_approved, coalesce(qr.n, 0) AS quick_replies, coalesce(sg.n, 0) AS segments,
           coalesce(ctb.n, 0) AS custom_tables, coalesce(crc.n, 0) AS custom_records,
           coalesce(mb.n, 0) AS members, coalesce(mb.admins, 0) AS members_admin,
           coalesce(inv.pending, 0) AS invites_pending, coalesce(inv.accepted, 0) AS invites_accepted, pr.last_seen AS last_seen_at,
           coalesce(ai.calls, 0) AS ai_calls, coalesce(ai.tokens, 0)::bigint AS ai_tokens, ai.last_at AS ai_last_at,
           coalesce(ak.active, 0) AS api_keys_active, ak.last_used AS api_key_last_used_at,
           coalesce(wh.active, 0) AS webhooks_active, wh.last_at AS webhook_last_at,
           greatest(cv.last_msg, pr.last_seen, ct.last_at, fm.last_lead, ak.last_used, au.last_at, fl.last_at, ai.last_at) AS last_activity_at
      FROM accounts a
      LEFT JOIN profiles o ON o.user_id = a.owner_user_id
      LEFT JOIN account_subscriptions s ON s.account_id = a.id
      LEFT JOIN ct ON ct.account_id = a.id LEFT JOIN cv ON cv.account_id = a.id LEFT JOIN ms ON ms.account_id = a.id
      LEFT JOIN wa ON wa.account_id = a.id LEFT JOIN fm ON fm.account_id = a.id LEFT JOIN dl ON dl.account_id = a.id
      LEFT JOIN au ON au.account_id = a.id LEFT JOIN fl ON fl.account_id = a.id LEFT JOIN bc ON bc.account_id = a.id
      LEFT JOIN tp ON tp.account_id = a.id LEFT JOIN qr ON qr.account_id = a.id LEFT JOIN sg ON sg.account_id = a.id
      LEFT JOIN ctb ON ctb.account_id = a.id LEFT JOIN crc ON crc.account_id = a.id LEFT JOIN mb ON mb.account_id = a.id
      LEFT JOIN inv ON inv.account_id = a.id LEFT JOIN pr ON pr.account_id = a.id LEFT JOIN ai ON ai.account_id = a.id
      LEFT JOIN ak ON ak.account_id = a.id LEFT JOIN wh ON wh.account_id = a.id
     WHERE p_account IS NULL OR a.id = p_account
  )
  SELECT b.account_id, b.name, b.created_at, b.owner_email, b.plan_id, b.subscription_status, b.current_period_end,
         b.onboarded_at, b.use_cases, b.heard_from,
         b.contacts_total, b.contacts_new, b.contacts_last_at, b.conversations_total, b.web_chat_conversations,
         b.msgs_in, b.msgs_out, b.msgs_template, b.msgs_delivered, b.msgs_read, b.msgs_failed, b.last_message_at,
         b.wa_total, b.wa_connected,
         b.forms_active, b.form_views, b.form_leads, b.form_conversion, b.form_last_lead_at,
         b.deals_open, b.deals_won,
         b.automations_active, b.automation_runs, b.automation_last_at,
         b.flows_active, b.flow_runs, b.flow_last_at,
         b.broadcasts_sent, b.broadcast_delivered, b.broadcast_replied,
         b.templates_approved, b.quick_replies, b.segments, b.custom_tables, b.custom_records,
         b.members, b.members_admin, b.invites_pending, b.invites_accepted, b.last_seen_at,
         b.ai_calls, b.ai_tokens, b.ai_last_at, b.api_keys_active, b.api_key_last_used_at, b.webhooks_active, b.webhook_last_at,
         b.last_activity_at,
         floor(extract(epoch FROM now() - coalesce(b.last_activity_at, b.created_at)) / 86400)::int AS days_since_activity,
         CASE
           WHEN b.created_at > now() - interval '7 days' THEN 'onboarding'
           WHEN b.wa_connected = 0 AND b.conversations_total = 0 AND b.forms_active = 0 THEN 'never_activated'
           WHEN coalesce(b.last_activity_at, b.created_at) >= now() - interval '14 days' THEN 'active'
           WHEN coalesce(b.last_activity_at, b.created_at) >= now() - interval '45 days' THEN 'slowing'
           ELSE 'dormant'
         END AS engagement
    FROM base b
$$;

REVOKE ALL ON FUNCTION admin.usage_by_account(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.usage_by_account(integer, uuid) TO ogadesk_admin_api;
