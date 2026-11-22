-- ============================================================
-- 073_billable_message_count
--
-- Backs the `messages_per_month` plan limit. "Billable" = outbound template
-- messages (marketing / utility / authentication): free-form replies inside
-- WhatsApp's 24-hour window are free on Meta's side and don't use the quota.
-- Called with the service-role key only. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION count_billable_messages(p_account UUID, p_since TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE c.account_id = p_account
     AND m.created_at >= p_since
     AND m.content_type = 'template'
     AND m.sender_type <> 'customer';
$$;

REVOKE ALL ON FUNCTION count_billable_messages(UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_billable_messages(UUID, TIMESTAMPTZ) TO service_role;
