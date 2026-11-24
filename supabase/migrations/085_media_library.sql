-- ============================================================
-- 085_media_library.sql — per-account image library
--
-- One shared place for every image an account uploads (form logo,
-- background, share image, template headers, flow media, media custom
-- fields), so a picture is uploaded once and reused everywhere. The
-- reusable <ImagePicker> shows these in its "Library" tab.
--
--   - `media-library` Storage bucket: public-read (the URL is embedded in
--     public forms and sent to Meta), 5 MB, raster images only. SVG is
--     deliberately NOT allowed: a public bucket would serve it inline and
--     SVG can carry script.
--   - `media_assets`: one row per uploaded image (name, size, dimensions,
--     uploader) so the library can list, search and delete without
--     scanning storage.
--
-- Path convention (same as chat-media): account-<account_id>/<uuid>.<ext>;
-- storage policies match the first segment against the caller's account.
--
-- RLS (table): any member reads; agent+ uploads; admin+ or the uploader
-- deletes. Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-library',
  'media-library',
  TRUE,
  5242880, -- 5 MB (Meta's image cap)
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Media library is publicly readable" ON storage.objects;
CREATE POLICY "Media library is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'media-library');

DROP POLICY IF EXISTS "Agents can upload to the media library" ON storage.objects;
CREATE POLICY "Agents can upload to the media library"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'media-library'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- Remove: the uploader, or an admin+ of the same account.
DROP POLICY IF EXISTS "Uploaders and admins can delete library media" ON storage.objects;
CREATE POLICY "Uploaders and admins can delete library media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'media-library'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (p.account_role IN ('owner', 'admin') OR (p.account_role = 'agent' AND owner = auth.uid()))
    )
  );

CREATE TABLE IF NOT EXISTS media_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  path        text NOT NULL,           -- object path inside the media-library bucket
  url         text NOT NULL,           -- public URL
  name        text NOT NULL,           -- original file name, for display
  mime        text NOT NULL,
  size_bytes  integer NOT NULL,
  width       integer,
  height      integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (path)
);

CREATE INDEX IF NOT EXISTS media_assets_account_created_idx
  ON media_assets (account_id, created_at DESC);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_assets_select ON media_assets;
CREATE POLICY media_assets_select ON media_assets FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS media_assets_insert ON media_assets;
CREATE POLICY media_assets_insert ON media_assets FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS media_assets_delete ON media_assets;
CREATE POLICY media_assets_delete ON media_assets FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    OR (is_account_member(account_id, 'agent') AND uploaded_by = auth.uid())
  );
