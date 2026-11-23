-- ============================================================
-- 081_currency.sql
--
-- Display-currency conversion. Prices are stored in the base currency (NGN);
-- visitors see them converted into their own currency using a daily-cached
-- rate from a free API. Charging is decided later with payments; this only
-- drives what people SEE.
--
--  * currency_settings : one row - base currency, the "convert for display"
--                        feature switch (default ON), and refresh bookkeeping.
--  * exchange_rates    : one row per quote currency, relative to the base.
--  * currency_audit_log: every base change / switch flip / manual override /
--                        rate refresh, so there is a trail. The future admin
--                        site edits settings and writes here.
-- Service-role only (RLS on, no policies). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS currency_settings (
  id                integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_currency     text NOT NULL DEFAULT 'NGN' CHECK (base_currency ~ '^[A-Z]{3}$'),
  convert_display   boolean NOT NULL DEFAULT true,
  rates_fetched_at  timestamptz,
  last_attempt_at   timestamptz,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO currency_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS exchange_rates (
  base        text NOT NULL CHECK (base ~ '^[A-Z]{3}$'),
  quote       text NOT NULL CHECK (quote ~ '^[A-Z]{3}$'),
  rate        numeric(24,10) NOT NULL CHECK (rate > 0),
  source      text NOT NULL DEFAULT 'open.er-api.com',
  is_override boolean NOT NULL DEFAULT false,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote)
);

CREATE TABLE IF NOT EXISTS currency_audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL DEFAULT 'system',
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS currency_audit_log_at_idx ON currency_audit_log (at DESC);

ALTER TABLE currency_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON currency_settings, exchange_rates, currency_audit_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE currency_audit_log_id_seq FROM anon, authenticated;

-- Partner money is recorded in the base currency (partners bank in naira).
ALTER TABLE partner_settings ALTER COLUMN currency SET DEFAULT 'NGN';
ALTER TABLE partner_settings ALTER COLUMN min_payout SET DEFAULT 20000;
UPDATE partner_settings SET currency = 'NGN', min_payout = 20000 WHERE id = 1 AND currency = 'USD' AND min_payout = 50;
