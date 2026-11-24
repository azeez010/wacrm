-- ============================================================
-- 084_webhook_deliveries.sql — Outbound webhook delivery log
--
-- One row per delivery attempt, so an admin can see why an endpoint
-- is failing (status code, error, response snippet) and resend an
-- event from the dashboard. Written best-effort by the deliverer with
-- the service-role client; read by admins only (the payload carries
-- customer phone numbers / message text).
--
-- Retention: rows are short-lived (14 days). The deliverer prunes
-- old rows opportunistically; `prune_webhook_deliveries()` can also
-- be scheduled (pg_cron / a Supabase scheduled function).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event            text NOT NULL,
  event_id         text,                       -- the `id` in the payload (receiver dedupe key)
  ok               boolean NOT NULL,
  status_code      integer,                    -- null when we never got a response
  duration_ms      integer,
  error            text,
  response_snippet text,                       -- first ~1KB of the response body
  payload          jsonb,                      -- exact event body, kept for "resend"
  resent_from      uuid,                       -- set when this attempt is a manual resend
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_created_idx
  ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_created_idx
  ON webhook_deliveries (created_at);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ only (payloads contain customer data). Writes happen
-- only through the service-role client, so no write policies.
DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.prune_webhook_deliveries(retention_days int DEFAULT 14)
RETURNS void AS $$
  DELETE FROM webhook_deliveries
  WHERE created_at < now() - make_interval(days => retention_days);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
