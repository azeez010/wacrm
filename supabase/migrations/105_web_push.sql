-- Web Push: one row per device that opted in to alerts while OgaDesk is closed,
-- plus the database trigger that pushes every new bell item (new lead, support
-- request, assignment) through the app.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  -- Per-device flood cap (see src/lib/push/send.ts).
  window_started_at TIMESTAMPTZ,
  window_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_account ON push_subscriptions(account_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- A user can see and remove their own devices. Writes go through the API (service role).
DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- Where the trigger calls and the shared secret it sends. No policies: only the
-- service role and the trigger (SECURITY DEFINER) can read it.
CREATE TABLE IF NOT EXISTS push_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dispatch_url TEXT,
  secret TEXT
);
ALTER TABLE push_config ENABLE ROW LEVEL SECURITY;
INSERT INTO push_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION push_notification_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT dispatch_url, secret INTO v_url, v_secret FROM push_config WHERE id = 1;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only worth calling when this user has a device registered.
  IF NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a push failure block the notification itself.
  RAISE WARNING 'push dispatch failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_push ON notifications;
CREATE TRIGGER on_notification_push
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION push_notification_dispatch();
