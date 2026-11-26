-- ============================================================
-- 120_announcement_bar_options.sql
-- Richer public (landing) announcement bar: colour style, badge, countdown and country targeting.
-- Additive columns with defaults only; existing rows keep working. Idempotent.
--   style         colour of the public bar (in-app banners keep using severity)
--   badge         {locale: text} pill shown before the text, e.g. BLACK FRIDAY
--   countdown_to  optional moment the bar counts down to (e.g. the end date or a sale start)
--   countries     ISO-3166 alpha-2 codes; empty = everyone
-- ============================================================
ALTER TABLE admin.announcements
  ADD COLUMN IF NOT EXISTS style        text NOT NULL DEFAULT 'brand',
  ADD COLUMN IF NOT EXISTS badge        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS countdown_to timestamptz,
  ADD COLUMN IF NOT EXISTS countries    text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_style_check') THEN
    ALTER TABLE admin.announcements ADD CONSTRAINT announcements_style_check
      CHECK (style IN ('brand', 'dark', 'gradient', 'info', 'success', 'warning', 'critical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_badge_check') THEN
    ALTER TABLE admin.announcements ADD CONSTRAINT announcements_badge_check CHECK (jsonb_typeof(badge) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_countries_check') THEN
    ALTER TABLE admin.announcements ADD CONSTRAINT announcements_countries_check
      CHECK (cardinality(countries) <= 50 AND array_to_string(countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
  END IF;
END $$;
