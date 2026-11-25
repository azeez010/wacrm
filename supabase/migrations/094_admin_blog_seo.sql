-- ============================================================
-- 094_admin_blog_seo.sql
--
-- Blog SEO for the public ogadesk.com/blog (served from api.ogadesk.com):
--  * admin.blog_posts gains category, tags, cover alt/size, canonical
--    override, noindex, FAQ (FAQPage structured data), word count and
--    reading time, and a soft-delete column.
--  * Slugs are unique among non-deleted posts only, so a deleted post's
--    slug can be reused.
--  * admin.blog_redirects keeps old slugs of renamed posts so old URLs
--    answer with a 301 instead of a 404.
-- Same lock-down as 088: RLS on, no anon/authenticated access, only the
-- ogadesk_admin_api role. Idempotent.
-- ============================================================

ALTER TABLE admin.blog_posts
  ADD COLUMN IF NOT EXISTS category           text,
  ADD COLUMN IF NOT EXISTS tags               jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_image_alt    text,
  ADD COLUMN IF NOT EXISTS cover_image_width  integer,
  ADD COLUMN IF NOT EXISTS cover_image_height integer,
  ADD COLUMN IF NOT EXISTS canonical_url      text,
  ADD COLUMN IF NOT EXISTS noindex            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS faq                jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS word_count         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reading_minutes    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at         timestamptz;

ALTER TABLE admin.blog_posts DROP CONSTRAINT IF EXISTS blog_posts_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS blog_posts_slug_live_key ON admin.blog_posts (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_public_idx ON admin.blog_posts (published_at DESC) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS blog_posts_category_idx ON admin.blog_posts (category) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admin.blog_redirects (
  old_slug   text PRIMARY KEY,
  post_id    uuid NOT NULL REFERENCES admin.blog_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin.blog_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin.blog_redirects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin.blog_redirects TO ogadesk_admin_api;
DROP POLICY IF EXISTS admin_api_all ON admin.blog_redirects;
CREATE POLICY admin_api_all ON admin.blog_redirects FOR ALL TO ogadesk_admin_api USING (true) WITH CHECK (true);
