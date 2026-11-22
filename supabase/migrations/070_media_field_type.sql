-- ============================================================
-- 070_media_field_type.sql
--
-- Adds the 'media' custom field type (one uploaded file per field).
-- The 066 constraint was created behind an IF NOT EXISTS guard, so it
-- has to be dropped and re-created to widen the allowed list.
-- Files themselves live in the existing `chat-media` bucket; no storage
-- change. Idempotent.
-- ============================================================

ALTER TABLE custom_fields DROP CONSTRAINT IF EXISTS custom_fields_type_check;
ALTER TABLE custom_fields
  ADD CONSTRAINT custom_fields_type_check
  CHECK (field_type IN
    ('text', 'number', 'bool', 'date', 'enum', 'multi_enum', 'reference', 'media'));
