-- ============================================================
-- 098_admin_dashboard_read.sql
--
-- Count-only reads for the admin console dashboard. The admin API role has
-- no access to messages, conversations, WhatsApp connections or deletion
-- requests; these SECURITY DEFINER functions return aggregates only, never
-- message text, phone numbers, tokens, Meta user ids or notes.
--   admin.dash_messaging(days)      volume, delivery/read/failure, top error codes
--   admin.dash_connections()        WhatsApp connection health
--   admin.dash_adoption(days)       how many businesses use each feature
--   admin.dash_deletion_requests()  Meta data-deletion queue (ids/status/dates)
-- EXECUTE only for ogadesk_admin_api. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION admin.dash_messaging(p_days integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH win AS (SELECT greatest(1, least(p_days, 90)) AS d),
  m AS (
    SELECT msg.created_at, msg.status, msg.content_type, msg.error_code, msg.error_title, c.account_id,
           (msg.sender_type = 'customer') AS inbound
      FROM messages msg
      JOIN conversations c ON c.id = msg.conversation_id
     WHERE msg.created_at >= now() - make_interval(days => (SELECT d FROM win))
       AND msg.content_type <> 'event'
  ),
  days AS (
    SELECT generate_series((now() AT TIME ZONE 'utc')::date - ((SELECT d FROM win) - 1), (now() AT TIME ZONE 'utc')::date, interval '1 day')::date AS day
  )
  SELECT jsonb_build_object(
    'days', (SELECT d FROM win),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'day', days.day,
                'inbound', (SELECT count(*) FROM m WHERE m.inbound AND (m.created_at AT TIME ZONE 'utc')::date = days.day),
                'outbound', (SELECT count(*) FROM m WHERE NOT m.inbound AND (m.created_at AT TIME ZONE 'utc')::date = days.day)
              ) ORDER BY days.day), '[]'::jsonb) FROM days),
    'totals', (SELECT jsonb_build_object(
                'inbound', count(*) FILTER (WHERE inbound),
                'outbound', count(*) FILTER (WHERE NOT inbound),
                'sending', count(*) FILTER (WHERE NOT inbound AND status = 'sending'),
                'sent', count(*) FILTER (WHERE NOT inbound AND status = 'sent'),
                'delivered', count(*) FILTER (WHERE NOT inbound AND status = 'delivered'),
                'read', count(*) FILTER (WHERE NOT inbound AND status = 'read'),
                'failed', count(*) FILTER (WHERE NOT inbound AND status = 'failed'),
                'billable', count(*) FILTER (WHERE NOT inbound AND content_type = 'template'),
                'accounts', count(DISTINCT account_id)
              ) FROM m),
    'errors', (SELECT coalesce(jsonb_agg(e ORDER BY (e->>'count')::int DESC), '[]'::jsonb) FROM (
                SELECT jsonb_build_object('code', error_code, 'title', max(error_title), 'count', count(*)) AS e
                  FROM m WHERE NOT inbound AND status = 'failed'
                 GROUP BY error_code ORDER BY count(*) DESC LIMIT 8) x),
    'topAccounts', (SELECT coalesce(jsonb_agg(t ORDER BY (t->>'outbound')::int DESC), '[]'::jsonb) FROM (
                SELECT jsonb_build_object('accountId', m.account_id, 'name', a.name, 'outbound', count(*)) AS t
                  FROM m JOIN accounts a ON a.id = m.account_id WHERE NOT m.inbound
                 GROUP BY m.account_id, a.name ORDER BY count(*) DESC LIMIT 5) y)
  )
$$;

CREATE OR REPLACE FUNCTION admin.dash_connections()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'byStatus', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status::text AS status, count(*) AS n FROM whatsapp_config GROUP BY status) s),
    'byMode', (SELECT coalesce(jsonb_object_agg(mode, n), '{}'::jsonb) FROM (SELECT mode::text AS mode, count(*) AS n FROM whatsapp_config WHERE mode IS NOT NULL GROUP BY mode) s),
    'accounts', (SELECT count(*) FROM accounts),
    'accountsConnected', (SELECT count(DISTINCT account_id) FROM whatsapp_config WHERE status = 'connected'),
    'webChatAccounts', (SELECT count(DISTINCT account_id) FROM conversations WHERE channel = 'web_chat'),
    -- Only that an error exists, plus which business: never the error text, phone, WABA id or token.
    'errored', (SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'name', a.name, 'updatedAt', w.updated_at) ORDER BY w.updated_at DESC), '[]'::jsonb)
                  FROM (SELECT DISTINCT ON (account_id) account_id, updated_at FROM whatsapp_config
                         WHERE last_registration_error IS NOT NULL ORDER BY account_id, updated_at DESC) w
                  JOIN accounts a ON a.id = w.account_id),
    'disconnected', (SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'name', a.name, 'updatedAt', w.updated_at) ORDER BY w.updated_at DESC), '[]'::jsonb)
                  FROM (SELECT DISTINCT ON (account_id) account_id, updated_at FROM whatsapp_config
                         WHERE status = 'disconnected' ORDER BY account_id, updated_at DESC LIMIT 20) w
                  JOIN accounts a ON a.id = w.account_id
                 WHERE NOT EXISTS (SELECT 1 FROM whatsapp_config x WHERE x.account_id = a.id AND x.status = 'connected'))
  )
$$;

CREATE OR REPLACE FUNCTION admin.dash_adoption(p_days integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  WITH since AS (SELECT now() - make_interval(days => greatest(1, least(p_days, 90))) AS t)
  SELECT jsonb_build_object(
    'accounts', (SELECT count(*) FROM accounts),
    'features', jsonb_build_array(
      jsonb_build_object('key', 'whatsapp', 'accounts', (SELECT count(DISTINCT account_id) FROM whatsapp_config WHERE status = 'connected')),
      jsonb_build_object('key', 'broadcasts', 'accounts', (SELECT count(DISTINCT account_id) FROM broadcasts WHERE created_at >= (SELECT t FROM since) AND status IN ('sending', 'sent'))),
      jsonb_build_object('key', 'automations', 'accounts', (SELECT count(DISTINCT account_id) FROM automations WHERE is_active)),
      jsonb_build_object('key', 'flows', 'accounts', (SELECT count(DISTINCT account_id) FROM flows WHERE status = 'active')),
      jsonb_build_object('key', 'forms', 'accounts', (SELECT count(DISTINCT account_id) FROM forms WHERE status = 'active' AND archived_at IS NULL)),
      jsonb_build_object('key', 'ai', 'accounts', (SELECT count(*) FROM ai_configs WHERE is_active)),
      jsonb_build_object('key', 'webChat', 'accounts', (SELECT count(DISTINCT account_id) FROM conversations WHERE channel = 'web_chat' AND created_at >= (SELECT t FROM since))),
      jsonb_build_object('key', 'publicApi', 'accounts', (SELECT count(DISTINCT account_id) FROM api_keys WHERE revoked_at IS NULL)),
      jsonb_build_object('key', 'webhooks', 'accounts', (SELECT count(DISTINCT account_id) FROM webhook_endpoints WHERE is_active))
    )
  )
$$;

CREATE OR REPLACE FUNCTION admin.dash_deletion_requests()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'byStatus', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status::text AS status, count(*) AS n FROM data_deletion_requests GROUP BY status) s),
    -- id/source/status/dates only: never meta_user_id, confirmation code or notes.
    'open', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'source', source, 'status', status, 'createdAt', created_at) ORDER BY created_at), '[]'::jsonb)
               FROM (SELECT id, source, status, created_at FROM data_deletion_requests
                      WHERE status IN ('received', 'in_progress') ORDER BY created_at LIMIT 50) o)
  )
$$;

REVOKE ALL ON FUNCTION admin.dash_messaging(integer), admin.dash_connections(), admin.dash_adoption(integer), admin.dash_deletion_requests()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.dash_messaging(integer), admin.dash_connections(), admin.dash_adoption(integer), admin.dash_deletion_requests()
  TO ogadesk_admin_api;
