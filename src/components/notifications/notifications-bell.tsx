'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUnreadNotifications } from '@/hooks/use-unread-notifications';
import { useNotifications } from '@/hooks/use-notifications';
import type { Notification } from '@/types';
import { NotificationItem } from './notification-item';

const RECENT = 10;

/** Header bell: unread count badge, and the latest notifications in a popover. */
export function NotificationsBell() {
  const t = useTranslations('Notifications');
  const tb = useTranslations('Header.bell');
  const ts = useTranslations('Sidebar');
  const router = useRouter();
  const unread = useUnreadNotifications();
  const [open, setOpen] = useState(false);

  // Only load the list (and listen for changes) while the popover is open;
  // the badge itself comes from the cheap count hook.
  const { notifications, error, actorNames, contactNames, markingAll, unreadIds, markRead, markAllRead } =
    useNotifications({ limit: RECENT, channel: 'notifications-bell', enabled: open });

  function handleClick(n: Notification) {
    if (!n.read_at) void markRead(n.id);
    setOpen(false);
    if (n.type === 'trial_ending' || n.type === 'trial_ended') router.push('/settings?tab=billing');
    else if (n.conversation_id) router.push(`/inbox?c=${n.conversation_id}`);
    else if (n.contact_id) router.push(`/contacts?open=${n.contact_id}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
        aria-label={unread > 0 ? ts('unreadNotifications', { count: unread }) : tb('label')}
        title={tb('label')}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-[18px] text-primary-foreground ring-2 ring-background">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium text-popover-foreground">{tb('label')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={unreadIds.length === 0 || markingAll}
            onClick={() => void markAllRead()}
          >
            {markingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
            {t('markAllRead')}
          </Button>
        </div>

        <div className="max-h-[22rem] divide-y divide-border/60 overflow-y-auto">
          {error ? (
            <p className="px-3 py-6 text-center text-xs text-destructive">{error}</p>
          ) : notifications === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('emptyDesc')}</p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                compact
                notification={n}
                actorName={n.actor_user_id ? actorNames[n.actor_user_id] : undefined}
                contactName={n.contact_id ? contactNames[n.contact_id] : undefined}
                onClick={handleClick}
              />
            ))
          )}
        </div>

        <div className="border-t border-border p-1">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-1.5 text-center text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {tb('viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
