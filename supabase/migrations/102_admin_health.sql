-- ============================================================
-- 102_admin_health.sql
-- Platform health signals for the admin console: counts and timestamps only, never payloads,
-- error text, phone numbers or tokens. EXECUTE only for ogadesk_admin_api. Idempotent.
-- Thresholds (green/amber/red) are applied by the API, so they can change without a migration.
-- ============================================================
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
    'deletions', (SELECT jsonb_build_object('open', count(*), 'oldest', min(created_at)) FROM data_deletion_requests WHERE status IN ('received', 'in_progress'))
  )
$$;
REVOKE ALL ON FUNCTION admin.dash_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.dash_health() TO ogadesk_admin_api;
