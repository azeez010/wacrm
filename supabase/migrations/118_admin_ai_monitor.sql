-- ============================================================
-- 118_admin_ai_monitor.sql
-- Spend / credit monitoring for platform AI and AI signals in system health. Counts and money only, never message text.
--   admin.ai_spend(days)   totals, per instance, per model, per day, per plan, failovers (platform-served calls)
--   admin.dash_health()    re-created with an 'ai' section (cooling instances, failovers, total failures) and aiLowBudget
-- EXECUTE only for ogadesk_admin_api. Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION admin.ai_spend(p_days integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  WITH w AS (SELECT now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90))) AS since),
  l AS (
    SELECT * FROM ai_usage_log WHERE source = 'platform' AND created_at >= (SELECT since FROM w)
  )
  SELECT jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 30), 90)),
    'totals', (SELECT jsonb_build_object(
        'calls', count(*) FILTER (WHERE provider <> 'none'), 'tokens', coalesce(sum(total_tokens), 0), 'costUsd', coalesce(sum(cost_usd), 0),
        'failedAll', count(*) FILTER (WHERE provider = 'none'),
        'failovers', count(*) FILTER (WHERE provider <> 'none' AND jsonb_array_length(coalesce(attempts, '[]'::jsonb)) > 1),
        'accounts', count(DISTINCT account_id)) FROM l),
    'byInstance', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'tokens')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('instanceId', l.instance_id, 'name', i.name, 'kind', i.kind, 'calls', count(*), 'tokens', coalesce(sum(l.total_tokens), 0),
               'costUsd', coalesce(sum(l.cost_usd), 0),
               'tokens24h', coalesce(sum(l.total_tokens) FILTER (WHERE l.created_at >= now() - interval '24 hours'), 0),
               'cost24h', coalesce(sum(l.cost_usd) FILTER (WHERE l.created_at >= now() - interval '24 hours'), 0)) AS x
          FROM l LEFT JOIN admin.ai_instances i ON i.id = l.instance_id WHERE l.provider <> 'none' GROUP BY l.instance_id, i.name, i.kind) y),
    'byModel', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'tokens')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('provider', provider, 'model', model, 'calls', count(*), 'tokens', coalesce(sum(total_tokens), 0), 'costUsd', coalesce(sum(cost_usd), 0)) AS x
          FROM l WHERE provider <> 'none' GROUP BY provider, model LIMIT 20) y),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d, 'tokens', tokens, 'costUsd', cost, 'calls', calls, 'failovers', fo) ORDER BY d), '[]'::jsonb) FROM (
        SELECT (created_at AT TIME ZONE 'utc')::date AS d, coalesce(sum(total_tokens), 0) AS tokens, coalesce(sum(cost_usd), 0) AS cost,
               count(*) FILTER (WHERE provider <> 'none') AS calls,
               count(*) FILTER (WHERE provider <> 'none' AND jsonb_array_length(coalesce(attempts, '[]'::jsonb)) > 1) AS fo
          FROM l GROUP BY 1) y),
    'byPlan', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'tokens')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('plan', coalesce(s.plan_id, 'free'), 'tokens', coalesce(sum(l.total_tokens), 0), 'costUsd', coalesce(sum(l.cost_usd), 0), 'accounts', count(DISTINCT l.account_id)) AS x
          FROM l LEFT JOIN account_subscriptions s ON s.account_id = l.account_id WHERE l.provider <> 'none' GROUP BY coalesce(s.plan_id, 'free')) y),
    'topAccounts', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'tokens')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('accountId', l.account_id, 'name', a.name, 'tokens', sum(l.total_tokens), 'costUsd', coalesce(sum(l.cost_usd), 0)) AS x
          FROM l JOIN accounts a ON a.id = l.account_id WHERE l.provider <> 'none' GROUP BY l.account_id, a.name ORDER BY sum(l.total_tokens) DESC LIMIT 10) y)
  )
$$;

CREATE OR REPLACE FUNCTION admin.dash_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, admin
AS $$
  SELECT jsonb_build_object(
    'now', now(),
    'messages', (SELECT jsonb_build_object(
        'out24h', count(*) FILTER (WHERE m.sender_type <> 'customer'),
        'failed24h', count(*) FILTER (WHERE m.sender_type <> 'customer' AND m.status = 'failed'))
      FROM messages m WHERE m.created_at >= now() - interval '24 hours' AND m.content_type <> 'event'),
    'lastInboundAt', (SELECT max(last_inbound_at) FROM conversations),
    'statusBacklog', (SELECT jsonb_build_object('count', count(*), 'oldest', min(created_at)) FROM pending_message_statuses),
    'webhooks', jsonb_build_object(
      'deliveries24h', (SELECT count(*) FROM webhook_deliveries WHERE created_at >= now() - interval '24 hours'),
      'failed24h', (SELECT count(*) FROM webhook_deliveries WHERE created_at >= now() - interval '24 hours' AND NOT ok),
      'endpointsFailing', (SELECT count(*) FROM webhook_endpoints WHERE is_active AND failure_count > 0),
      'endpointsDisabled', (SELECT count(*) FROM webhook_endpoints WHERE NOT is_active AND failure_count > 0)),
    'outbox', (SELECT jsonb_build_object(
        'pending', count(*) FILTER (WHERE status = 'pending'),
        'dead', count(*) FILTER (WHERE status = 'dead'),
        'stuck', count(*) FILTER (WHERE status = 'processing' AND locked_at < now() - interval '15 minutes'),
        'oldestPending', min(created_at) FILTER (WHERE status = 'pending'))
      FROM crm_outbox WHERE status <> 'sent'),
    'automations', jsonb_build_object(
      'failed24h', (SELECT count(*) FROM automation_logs WHERE status = 'failed' AND created_at >= now() - interval '24 hours'),
      'runs24h', (SELECT count(*) FROM automation_logs WHERE created_at >= now() - interval '24 hours')),
    'flows', jsonb_build_object(
      'failed24h', (SELECT count(*) FROM flow_runs WHERE status IN ('failed', 'timed_out') AND ended_at >= now() - interval '24 hours'),
      'ended24h', (SELECT count(*) FROM flow_runs WHERE ended_at >= now() - interval '24 hours')),
    'whatsapp', jsonb_build_object(
      'registrationErrors', (SELECT count(*) FROM whatsapp_config WHERE last_registration_error IS NOT NULL),
      'disconnected', (SELECT count(*) FROM whatsapp_config WHERE status = 'disconnected')),
    'fx', (SELECT jsonb_build_object('fetchedAt', rates_fetched_at, 'lastAttemptAt', last_attempt_at, 'hasError', last_error IS NOT NULL) FROM currency_settings WHERE id = 1),
    'formsStatsAt', (SELECT max(stats_updated_at) FROM forms),
    'deletions', (SELECT jsonb_build_object('open', count(*), 'oldest', min(created_at)) FROM data_deletion_requests WHERE status IN ('received', 'in_progress')),
    'ai', (SELECT jsonb_build_object(
        'instances', (SELECT count(*) FROM admin.ai_instances WHERE enabled),
        'cooling', (SELECT count(*) FROM admin.ai_instances WHERE enabled AND cooldown_until > now()),
        'calls24h', count(*) FILTER (WHERE source = 'platform' AND NOT (provider = 'none')),
        'failedAll24h', count(*) FILTER (WHERE source = 'platform' AND provider = 'none'),
        'failovers24h', count(*) FILTER (WHERE source = 'platform' AND provider <> 'none' AND jsonb_array_length(coalesce(attempts, '[]'::jsonb)) > 1))
      FROM ai_usage_log WHERE created_at >= now() - interval '24 hours'),
    'aiLowBudget', (SELECT count(*) FROM admin.ai_instances i WHERE i.enabled AND i.budget_usd IS NOT NULL AND i.alert_below_usd IS NOT NULL
        AND i.budget_usd - coalesce((SELECT sum(cost_usd) FROM ai_usage_log l WHERE l.instance_id = i.id AND l.created_at >= coalesce(i.budget_set_at, now())), 0) < i.alert_below_usd)
  )
$$;
REVOKE ALL ON FUNCTION admin.ai_spend(integer), admin.dash_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.ai_spend(integer), admin.dash_health() TO ogadesk_admin_api;
