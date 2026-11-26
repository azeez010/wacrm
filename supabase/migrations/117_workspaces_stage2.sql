-- ============================================================
-- 117_workspaces_stage2.sql — multi-workspace, stage 2 (NO behaviour change today)
--
-- Membership questions that used to read `profiles` now read `account_members`
-- (migration 116), and "which workspace is the caller in" goes through
-- current_account_id(). While profiles still mirrors account_members one-to-one the
-- answers are identical; once a user can belong to several workspaces they stay correct.
--   * dashboard_overview            caller workspace, team list and member count
--   * active_announcements          membership/role of the caller in the asked workspace
--   * notify_conversation_assigned  "is the assignee a member of this workspace"
--   * enforce_conversation_assignee_membership   same check, both branches
--   * 13 storage.objects policies   membership by account folder
-- NOT in this stage (rewritten with the invite/remove flows in stage 3): set_member_role,
-- transfer_account_ownership, remove_account_member, redeem_invitation. Admin-console
-- functions move in stage 5.
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dashboard_overview(p_days integer, p_tz text DEFAULT 'UTC'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account UUID;
  v_tz TEXT := 'UTC';
  v_now TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end TIMESTAMPTZ;
  v_unit TEXT;
  v_step INTERVAL;
  v_target INTEGER;
  v_attention JSONB;
  v_replies JSONB;
  v_volume JSONB;
  v_kpis JSONB;
  v_pipeline JSONB;
  v_campaigns JSONB;
  v_setup JSONB;
BEGIN
  v_account := public.current_account_id();

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'caller is not a member of an account' USING ERRCODE = '42501';
  END IF;

  IF p_days IS NULL OR p_days NOT IN (1, 7, 30, 90) THEN
    RAISE EXCEPTION 'p_days must be one of 1, 7, 30, 90' USING ERRCODE = '22023';
  END IF;

  IF p_tz IS NOT NULL THEN
    BEGIN
      PERFORM v_now AT TIME ZONE p_tz;
      v_tz := p_tz;
    EXCEPTION WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
    END;
  END IF;

  v_start := (date_trunc('day', v_now AT TIME ZONE v_tz) - make_interval(days => p_days - 1)) AT TIME ZONE v_tz;
  v_prev_start := v_start - make_interval(days => p_days);
  v_prev_end := v_now - make_interval(days => p_days);
  v_unit := CASE WHEN p_days = 1 THEN 'hour' ELSE 'day' END;
  v_step := CASE WHEN p_days = 1 THEN interval '1 hour' ELSE interval '1 day' END;

  SELECT a.reply_target_minutes INTO v_target FROM accounts a WHERE a.id = v_account;
  v_target := COALESCE(v_target, 5);

  WITH awaiting AS (
    SELECT
      c.id,
      c.contact_id,
      c.assigned_agent_id,
      c.last_message_text,
      c.last_inbound_at,
      (c.ai_autoreply_disabled AND c.ai_handoff_summary IS NOT NULL) AS handed_off,
      COALESCE((
        SELECT min(m.created_at)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND m.created_at > COALESCE(c.last_reply_at, '-infinity'::timestamptz)
      ), c.last_inbound_at) AS waiting_since
    FROM conversations c
    WHERE c.account_id = v_account
      AND c.status <> 'closed'
      AND c.last_inbound_at IS NOT NULL
      AND (c.last_reply_at IS NULL OR c.last_reply_at < c.last_inbound_at)
  ),
  failed AS (
    SELECT m.id, m.conversation_id, m.content_text, m.error_code, m.error_title, m.created_at,
           ct.name AS contact_name, ct.phone AS contact_phone
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.account_id = v_account
      AND m.sender_type <> 'customer'
      AND m.status = 'failed'
      AND m.created_at >= v_now - interval '24 hours'
  )
  SELECT jsonb_build_object(
    'waiting', (SELECT count(*) FROM awaiting),
    'oldestWaitingSince', (SELECT min(waiting_since) FROM awaiting),
    'waitingOverTarget', (SELECT count(*) FROM awaiting WHERE waiting_since < v_now - make_interval(mins => v_target)),
    'unassigned', (
      SELECT count(*) FROM conversations c
      WHERE c.account_id = v_account AND c.status = 'open' AND c.assigned_agent_id IS NULL
    ),
    'windowsClosing', (
      SELECT count(*) FROM awaiting
      WHERE last_inbound_at > v_now - interval '24 hours'
        AND last_inbound_at <= v_now - interval '22 hours'
    ),
    'failed', (SELECT count(*) FROM failed),
    'failedMessages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'conversationId', f.conversation_id,
        'contactName', f.contact_name,
        'contactPhone', f.contact_phone,
        'preview', left(f.content_text, 120),
        'errorCode', f.error_code,
        'errorTitle', f.error_title,
        'at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM failed ORDER BY created_at DESC LIMIT 10) f
    ), '[]'::jsonb),
    'queue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversationId', q.id,
        'contactName', ct.name,
        'contactPhone', ct.phone,
        'avatarUrl', ct.avatar_url,
        'preview', left(q.last_message_text, 120),
        'waitingSince', q.waiting_since,
        'windowClosesAt', q.last_inbound_at + interval '24 hours',
        'assignedAgentId', q.assigned_agent_id,
        'handedOff', COALESCE(q.handed_off, false)
      ) ORDER BY q.waiting_since)
      FROM (SELECT * FROM awaiting ORDER BY waiting_since LIMIT 6) q
      LEFT JOIN contacts ct ON ct.id = q.contact_id
    ), '[]'::jsonb)
  ) INTO v_attention;

  WITH msgs AS (
    SELECT m.id, m.conversation_id, m.sender_type, m.ai_generated, m.status, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_prev_start - interval '1 day'
  ),
  streams AS (
    SELECT
      'human'::text AS kind,
      conversation_id,
      created_at,
      sender_type = 'customer' AS is_customer,
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id) AS prev_customer
    FROM msgs
    WHERE sender_type = 'customer' OR (sender_type = 'agent' AND status <> 'failed')
    UNION ALL
    SELECT
      'ai'::text,
      conversation_id,
      created_at,
      sender_type = 'customer',
      lag(sender_type = 'customer') OVER (PARTITION BY conversation_id ORDER BY created_at, id)
    FROM msgs
    WHERE sender_type = 'customer' OR (ai_generated AND status <> 'failed')
  ),
  turns AS (
    SELECT
      s.kind,
      s.created_at AS asked_at,
      r.sender_id AS reply_agent,
      extract(epoch FROM r.created_at - s.created_at) / 60.0 AS minutes
    FROM streams s
    CROSS JOIN LATERAL (
      SELECT m2.sender_id, m2.created_at
      FROM messages m2
      WHERE m2.conversation_id = s.conversation_id
        AND m2.created_at > s.created_at
        AND m2.status <> 'failed'
        AND CASE WHEN s.kind = 'human' THEN m2.sender_type = 'agent' ELSE m2.ai_generated END
      ORDER BY m2.created_at, m2.id
      LIMIT 1
    ) r
    WHERE s.is_customer
      AND s.prev_customer IS NOT TRUE
      AND s.created_at >= v_prev_start
  ),
  members AS (
    SELECT p.user_id, p.full_name, p.avatar_url, m.account_role
    FROM account_members m
    JOIN profiles p ON p.user_id = m.user_id
    WHERE m.account_id = v_account
  )
  SELECT jsonb_build_object(
    'medianHuman', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_start
    ),
    'medianHumanPrevious', (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
      FROM turns WHERE kind = 'human' AND asked_at >= v_prev_start AND asked_at < v_prev_end
    ),
    'team', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', mb.user_id,
        'name', mb.full_name,
        'avatarUrl', mb.avatar_url,
        'role', mb.account_role,
        'presence', mp.status,
        'lastSeenAt', mp.last_seen_at,
        'open', (
          SELECT count(*) FROM conversations c
          WHERE c.account_id = v_account AND c.status <> 'closed' AND c.assigned_agent_id = mb.user_id
        ),
        'replies', (
          SELECT count(*) FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        ),
        'medianMinutes', (
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
          FROM turns
          WHERE kind = 'human' AND reply_agent = mb.user_id AND asked_at >= v_start
        )
      ) ORDER BY mb.full_name NULLS LAST)
      FROM members mb
      LEFT JOIN member_presence mp ON mp.user_id = mb.user_id AND mp.account_id = v_account
    ), '[]'::jsonb),
    'ai', jsonb_build_object(
      'replies', (
        SELECT count(*)
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.account_id = v_account AND m.ai_generated AND m.created_at >= v_start
      ),
      'medianMinutes', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FROM turns WHERE kind = 'ai' AND asked_at >= v_start
      )
    )
  ) INTO v_replies;

  WITH buckets AS (
    SELECT b
    FROM generate_series(
      date_trunc(v_unit, v_start AT TIME ZONE v_tz),
      date_trunc(v_unit, v_now AT TIME ZONE v_tz),
      v_step
    ) AS b
  ),
  period_msgs AS (
    SELECT m.sender_type, m.created_at AT TIME ZONE v_tz AS local_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account
      AND m.created_at >= v_start
  ),
  msg_counts AS (
    SELECT date_trunc(v_unit, local_at) AS b,
           count(*) FILTER (WHERE sender_type = 'customer') AS incoming,
           count(*) FILTER (WHERE sender_type <> 'customer') AS outgoing
    FROM period_msgs
    GROUP BY 1
  ),
  conv_counts AS (
    SELECT date_trunc(v_unit, created_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND created_at >= v_start
    GROUP BY 1
  ),
  resolved_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM conversations
    WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    GROUP BY 1
  ),
  won_counts AS (
    SELECT date_trunc(v_unit, closed_at AT TIME ZONE v_tz) AS b, count(*) AS n
    FROM deals
    WHERE account_id = v_account AND status = 'won' AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = v_account AND kind = 'sales') AND closed_at >= v_start
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        't', to_char(bk.b, 'YYYY-MM-DD"T"HH24:MI'),
        'incoming', COALESCE(mc.incoming, 0),
        'outgoing', COALESCE(mc.outgoing, 0),
        'newConversations', COALESCE(cc.n, 0),
        'resolved', COALESCE(rc.n, 0),
        'dealsWon', COALESCE(wc.n, 0)
      ) ORDER BY bk.b)
      FROM buckets bk
      LEFT JOIN msg_counts mc ON mc.b = bk.b
      LEFT JOIN conv_counts cc ON cc.b = bk.b
      LEFT JOIN resolved_counts rc ON rc.b = bk.b
      LEFT JOIN won_counts wc ON wc.b = bk.b
    ), '[]'::jsonb),
    'hourly', (
      SELECT jsonb_agg(COALESCE(h.n, 0) ORDER BY hr.hour)
      FROM generate_series(0, 23) AS hr(hour)
      LEFT JOIN (
        SELECT extract(hour FROM local_at)::int AS hour, count(*) AS n
        FROM period_msgs
        WHERE sender_type = 'customer'
        GROUP BY 1
      ) h ON h.hour = hr.hour
    )
  ) INTO v_volume;

  SELECT jsonb_build_object(
    'newConversations', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'newConversationsPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'resolved', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_start
    ),
    'resolvedPrevious', (
      SELECT count(*) FROM conversations
      WHERE account_id = v_account AND status = 'closed' AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWon', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = v_account AND kind = 'sales') AND closed_at >= v_start
    ),
    'dealsWonPrevious', (
      SELECT count(*) FROM deals
      WHERE account_id = v_account AND status = 'won' AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = v_account AND kind = 'sales') AND closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'dealsWonValue', (
      SELECT COALESCE(sum(value), 0) FROM deals
      WHERE account_id = v_account AND status = 'won' AND pipeline_id IN (SELECT id FROM pipelines WHERE account_id = v_account AND kind = 'sales') AND closed_at >= v_start
    ),
    'broadcastDelivered', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastRead', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_start
    ),
    'broadcastDeliveredPrevious', (
      SELECT COALESCE(sum(delivered_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    ),
    'broadcastReadPrevious', (
      SELECT COALESCE(sum(read_count), 0) FROM broadcasts
      WHERE account_id = v_account AND status IN ('sending', 'sent')
        AND COALESCE(scheduled_at, created_at) >= v_prev_start
        AND COALESCE(scheduled_at, created_at) < v_prev_end
    )
  ) INTO v_kpis;

  SELECT jsonb_build_object(
    'pipelines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) ORDER BY pl.created_at, pl.id)
      FROM pipelines pl
      WHERE pl.account_id = v_account AND pl.kind = 'sales'
    ), '[]'::jsonb),
    'stages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'pipelineId', s.pipeline_id,
        'name', s.name,
        'color', s.color,
        'dealCount', (SELECT count(*) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open'),
        'totalValue', (SELECT COALESCE(sum(d.value), 0) FROM deals d WHERE d.stage_id = s.id AND d.status = 'open')
      ) ORDER BY s.position, s.created_at)
      FROM pipeline_stages s
      JOIN pipelines pl ON pl.id = s.pipeline_id
      WHERE pl.account_id = v_account AND pl.kind = 'sales'
    ), '[]'::jsonb),
    'stats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'pipelineId', pl.id,
        'won', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'lost', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'lost' AND d.closed_at >= v_start
        ),
        'avgDaysToWin', (
          SELECT avg(extract(epoch FROM d.closed_at - d.created_at) / 86400.0) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'won' AND d.closed_at >= v_start
        ),
        'idleDeals', (
          SELECT count(*) FROM deals d
          WHERE d.pipeline_id = pl.id AND d.status = 'open' AND d.updated_at < v_now - interval '7 days'
        )
      ))
      FROM pipelines pl
      WHERE pl.account_id = v_account AND pl.kind = 'sales'
    ), '[]'::jsonb)
  ) INTO v_pipeline;

  SELECT jsonb_build_object(
    'latestBroadcast', (
      SELECT jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'status', b.status,
        'at', COALESCE(b.scheduled_at, b.created_at),
        'recipients', b.total_recipients,
        'delivered', b.delivered_count,
        'read', b.read_count,
        'replied', b.replied_count,
        'failed', b.failed_count
      )
      FROM broadcasts b
      WHERE b.account_id = v_account AND b.status IN ('sending', 'sent', 'failed')
      ORDER BY COALESCE(b.scheduled_at, b.created_at) DESC
      LIMIT 1
    ),
    'automationRuns', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start
    ),
    'automationFailed', (
      SELECT count(*) FROM automation_logs
      WHERE account_id = v_account AND created_at >= v_start AND status = 'failed'
    ),
    'flowFailed', (
      SELECT count(*) FROM flow_runs
      WHERE account_id = v_account AND status = 'failed' AND ended_at >= v_start
    ),
    'topFailingFlow', (
      SELECT jsonb_build_object('id', f.id, 'name', f.name, 'failed', count(*))
      FROM flow_runs r
      JOIN flows f ON f.id = r.flow_id
      WHERE r.account_id = v_account AND r.status = 'failed' AND r.ended_at >= v_start
      GROUP BY f.id, f.name
      ORDER BY count(*) DESC, f.name
      LIMIT 1
    ),
    'templatesApproved', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'templatesRejected', (
      SELECT count(*) FROM message_templates
      WHERE account_id = v_account AND status = 'REJECTED'
    )
  ) INTO v_campaigns;

  SELECT jsonb_build_object(
    'whatsappConnected', EXISTS (
      SELECT 1 FROM whatsapp_config WHERE account_id = v_account AND status = 'connected'
    ),
    'hasContacts', EXISTS (SELECT 1 FROM contacts WHERE account_id = v_account),
    'hasApprovedTemplate', EXISTS (
      SELECT 1 FROM message_templates WHERE account_id = v_account AND status = 'APPROVED'
    ),
    'memberCount', (SELECT count(*) FROM account_members WHERE account_id = v_account),
    'hasConversations', EXISTS (SELECT 1 FROM conversations WHERE account_id = v_account)
  ) INTO v_setup;

  RETURN jsonb_build_object(
    'generatedAt', v_now,
    'timeZone', v_tz,
    'days', p_days,
    'unit', v_unit,
    'periodStart', v_start,
    'previousStart', v_prev_start,
    'previousEnd', v_prev_end,
    'replyTargetMinutes', v_target,
    'attention', v_attention,
    'replies', v_replies,
    'volume', v_volume,
    'kpis', v_kpis,
    'pipeline', v_pipeline,
    'campaigns', v_campaigns,
    'setup', v_setup
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.active_announcements(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'admin'
AS $function$
DECLARE
  v_role text;
BEGIN
  -- Only members of the business, and only for themselves.
  IF auth.uid() IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT account_role::text INTO v_role FROM account_members WHERE user_id = auth.uid() AND account_id = p_account;
  IF v_role IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'severity', a.severity, 'title', a.title, 'body', a.body,
             'linkUrl', a.link_url, 'linkLabel', a.link_label, 'dismissible', a.dismissible)
           ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.published_at DESC)
      FROM admin.announcements a
     WHERE a.kind = 'in_app' AND a.status = 'live'
       AND (a.starts_at IS NULL OR a.starts_at <= now()) AND (a.ends_at IS NULL OR a.ends_at > now())
       AND (NOT a.owners_only OR v_role IN ('owner', 'admin'))
       AND (a.audience_all OR EXISTS (SELECT 1 FROM admin.announcement_targets t WHERE t.announcement_id = a.id AND t.account_id = p_account))
  ), '[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.notify_conversation_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM account_members
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_conversation_assignee_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM account_members
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND EXISTS (
       SELECT 1 FROM account_members
       WHERE user_id = OLD.assigned_agent_id
         AND account_id = OLD.account_id
     )
  THEN
    NEW.assigned_agent_id := OLD.assigned_agent_id;
  ELSE
    NEW.assigned_agent_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS "Agents can upload to the media library" ON storage.objects;
CREATE POLICY "Agents can upload to the media library" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((bucket_id = 'media-library'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Agents upload knowledge files" ON storage.objects;
CREATE POLICY "Agents upload knowledge files" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((bucket_id = 'knowledge-files'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media" ON storage.objects
  AS PERMISSIVE FOR DELETE TO public
  USING (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media" ON storage.objects
  AS PERMISSIVE FOR DELETE TO public
  USING (((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1])))))));

DROP POLICY IF EXISTS "Members can read chat media" ON storage.objects;
CREATE POLICY "Members can read chat media" ON storage.objects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Members can read flow media" ON storage.objects;
CREATE POLICY "Members can read flow media" ON storage.objects
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'flow-media'::text) AND ((EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1])))) OR ((auth.uid())::text = (storage.foldername(name))[1]))));

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO public
  USING (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))))
  WITH CHECK (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO public
  USING (((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1])))))))
  WITH CHECK (((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1])))))));

DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((bucket_id = 'chat-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media" ON storage.objects
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((bucket_id = 'flow-media'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum, 'agent'::account_role_enum])) AND ((('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) OR ((auth.uid())::text = (storage.foldername(objects.name))[1])))))));

DROP POLICY IF EXISTS "Members read knowledge files" ON storage.objects;
CREATE POLICY "Members read knowledge files" ON storage.objects
  AS PERMISSIVE FOR SELECT TO public
  USING (((bucket_id = 'knowledge-files'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]))))));

DROP POLICY IF EXISTS "Uploaders and admins can delete library media" ON storage.objects;
CREATE POLICY "Uploaders and admins can delete library media" ON storage.objects
  AS PERMISSIVE FOR DELETE TO public
  USING (((bucket_id = 'media-library'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) AND ((p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum])) OR ((p.account_role = 'agent'::account_role_enum) AND (objects.owner = auth.uid()))))))));

DROP POLICY IF EXISTS "Uploaders and admins delete knowledge files" ON storage.objects;
CREATE POLICY "Uploaders and admins delete knowledge files" ON storage.objects
  AS PERMISSIVE FOR DELETE TO public
  USING (((bucket_id = 'knowledge-files'::text) AND (EXISTS ( SELECT 1
   FROM account_members p
  WHERE ((p.user_id = auth.uid()) AND (('account-'::text || (p.account_id)::text) = (storage.foldername(objects.name))[1]) AND ((p.account_role = ANY (ARRAY['owner'::account_role_enum, 'admin'::account_role_enum])) OR ((p.account_role = 'agent'::account_role_enum) AND (objects.owner = auth.uid()))))))));
