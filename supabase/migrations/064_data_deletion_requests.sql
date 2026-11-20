-- Meta "User Data Deletion Request" callback log.
--
-- When someone removes the app from their Facebook settings, Meta POSTs a
-- signed request to /api/meta/data-deletion and expects a confirmation code
-- plus a URL where the person can check the status. This table is that
-- record. It deliberately stores only what Meta sends (the app-scoped user
-- id) - we hold no Facebook profile data of our own to look up.
--
-- Written and read by the service role only (the public status page reads
-- by the unguessable confirmation code).

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confirmation_code TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'meta_callback'
    CHECK (source IN ('meta_callback', 'meta_deauthorize', 'email')),
  meta_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'in_progress', 'completed', 'rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_created
  ON data_deletion_requests (created_at DESC);

ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;
-- No policies: nobody but the service role can read or write.
