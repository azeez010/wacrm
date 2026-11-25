-- ============================================================
-- 093_admin_capabilities_granular.sql
--
-- The admin console moved from three coarse capabilities to granular ones.
-- This rewrites the capability lists already stored on admin.admin_users so
-- nobody loses (or gains) access:
--   analytics.read       -> dashboard.business, dashboard.messaging,
--                           dashboard.connections, dashboard.partners, growth.read
--   blog.manage          -> blog.read, blog.write, blog.publish, blog.delete, files.upload
--   subscriptions.manage -> subscriptions.plan_change, subscriptions.payments.confirm,
--                           subscriptions.expire, subscriptions.overrides
-- Everything else is kept as is. Superadmins bypass capability checks, so
-- their lists are unaffected in practice. Idempotent: rows with no legacy
-- key are not touched.
-- ============================================================

UPDATE admin.admin_users u
   SET capabilities = COALESCE((
         SELECT jsonb_agg(DISTINCT m.cap ORDER BY m.cap)
           FROM jsonb_array_elements_text(u.capabilities) AS k(key)
           CROSS JOIN LATERAL unnest(
             CASE k.key
               WHEN 'analytics.read' THEN ARRAY[
                 'dashboard.business', 'dashboard.messaging', 'dashboard.connections',
                 'dashboard.partners', 'growth.read']
               WHEN 'blog.manage' THEN ARRAY[
                 'blog.read', 'blog.write', 'blog.publish', 'blog.delete', 'files.upload']
               WHEN 'subscriptions.manage' THEN ARRAY[
                 'subscriptions.plan_change', 'subscriptions.payments.confirm',
                 'subscriptions.expire', 'subscriptions.overrides']
               ELSE ARRAY[k.key]
             END
           ) AS m(cap)
       ), '[]'::jsonb)
 WHERE u.capabilities ?| ARRAY['analytics.read', 'blog.manage', 'subscriptions.manage'];
