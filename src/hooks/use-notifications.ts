'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { notificationsAccountFilter } from '@/lib/notifications/unread-count';
import {
  markAllReadLocal,
  markOneRead,
  mergeNotification,
  prependNotification,
  removeNotification,
  unreadIdsOf,
} from '@/lib/notifications/list-state';
import type { Notification } from '@/types';

/**
 * The account's notifications with live updates, resolved names and
 * optimistic mark-read. Shared by the Notifications page (limit 100) and the
 * header bell (latest few), so both behave the same.
 */
export function useNotifications(opts: { limit?: number; channel: string; enabled?: boolean }) {
  const { limit = 100, channel, enabled = true } = opts;
  const t = useTranslations('Notifications');
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    const rows = (data ?? []) as Notification[];
    const actorIds = [...new Set(rows.flatMap((row) => (row.actor_user_id ? [row.actor_user_id] : [])))];
    const contactIds = [...new Set(rows.flatMap((row) => (row.contact_id ? [row.contact_id] : [])))];
    // The database stores English copy. Resolve the structured references so
    // the UI can translate it while keeping people's names.
    const [actors, contacts] = await Promise.all([
      actorIds.length
        ? supabase.from('profiles').select('user_id, full_name').eq('account_id', accountId).in('user_id', actorIds)
        : Promise.resolve({ data: [] }),
      contactIds.length
        ? supabase.from('contacts').select('id, name, phone').eq('account_id', accountId).in('id', contactIds)
        : Promise.resolve({ data: [] }),
    ]);
    setActorNames(Object.fromEntries((actors.data ?? []).map((row) => [row.user_id, row.full_name?.trim() || ''])));
    setContactNames(Object.fromEntries((contacts.data ?? []).map((row) => [row.id, row.name?.trim() || row.phone || ''])));
    setError(null);
    setNotifications(rows);
  }, [accountId, limit]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, enabled]);

  // Realtime: new assignments appear without a refresh, and "mark all read"
  // from another tab or device stays in sync.
  useEffect(() => {
    if (!accountId || !enabled) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`${channel}:${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: notificationsAccountFilter(accountId) },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotifications((prev) => prependNotification(prev, payload.new as Notification));
            void load();
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((prev) => mergeNotification(prev, payload.new as Notification));
          } else if (payload.eventType === 'DELETE') {
            setNotifications((prev) => removeNotification(prev, (payload.old as Partial<Notification>).id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [accountId, channel, load, enabled]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic: the row is already "read" before the request lands.
      setNotifications((prev) => markOneRead(prev, id, new Date().toISOString()));
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (updateErr) {
        toast.error(t('markReadFailed'));
        void load();
      }
    },
    [load, t]
  );

  const unreadIds = unreadIdsOf(notifications);

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0 || !accountId) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications((prev) => markAllReadLocal(prev, now));
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('account_id', accountId)
      .is('read_at', null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error(t('markAllFailed'));
      void load();
    }
  }, [unreadIds.length, accountId, load, t]);

  return { notifications, error, actorNames, contactNames, markingAll, unreadIds, markRead, markAllRead, reload: load };
}
