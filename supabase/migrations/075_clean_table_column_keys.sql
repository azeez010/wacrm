-- ============================================================
-- 075_clean_table_column_keys.sql
--
-- Table columns created before the previous release got "_field" appended
-- to their key when the name was reserved for the built-in contact columns
-- (name, phone, email, company, tags, id, created_at, updated_at), e.g.
-- "name_field". Reserved names only apply to CONTACT fields, so these are
-- renamed to the plain key ("name"), and everything that stores the key
-- follows: custom_records.data and the table's label_field_key.
-- A column is left alone if the plain key is already taken in its table.
-- Idempotent.
-- ============================================================

DO $$
DECLARE
  r RECORD;
  base TEXT;
BEGIN
  FOR r IN
    SELECT f.id, f.key, f.table_id, t.label_field_key
    FROM custom_fields f
    JOIN custom_tables t ON t.id = f.table_id
    WHERE f.table_id IS NOT NULL
      AND f.key ~ '_field$'
  LOOP
    base := regexp_replace(r.key, '_field$', '');
    CONTINUE WHEN base NOT IN ('id', 'name', 'phone', 'email', 'company', 'tags', 'created_at', 'updated_at');
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM custom_fields x WHERE x.table_id = r.table_id AND x.key = base
    );

    UPDATE custom_fields SET key = base WHERE id = r.id;

    UPDATE custom_records
    SET data = (data - r.key) || jsonb_build_object(base, data -> r.key)
    WHERE table_id = r.table_id AND data ? r.key;

    UPDATE custom_tables
    SET label_field_key = base
    WHERE id = r.table_id AND label_field_key = r.key;
  END LOOP;
END $$;
