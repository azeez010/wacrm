-- ============================================================
-- 119_admin_ai_instance_spend.sql
-- Tracked spend of one AI provider instance since its budget was entered (for providers with no balance API:
-- remaining ~ budget - spend). Money only. EXECUTE only for ogadesk_admin_api (which cannot read ai_usage_log). Idempotent.
-- ============================================================
CREATE OR REPLACE FUNCTION admin.ai_instance_spent(p_instance uuid, p_since timestamptz)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, admin
AS $$
  SELECT coalesce(sum(cost_usd), 0) FROM ai_usage_log WHERE instance_id = p_instance AND created_at >= coalesce(p_since, now())
$$;
REVOKE ALL ON FUNCTION admin.ai_instance_spent(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin.ai_instance_spent(uuid, timestamptz) TO ogadesk_admin_api;
