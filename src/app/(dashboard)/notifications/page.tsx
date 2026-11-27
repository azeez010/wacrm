"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Notification } from "@/types";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useNotifications } from "@/hooks/use-notifications";
import { NotificationItem } from "@/components/notifications/notification-item";

export default function NotificationsPage() {
  const t = useTranslations("Notifications");
  const router = useRouter();
  const { notifications, error, actorNames, contactNames, markingAll, unreadIds, markRead, markAllRead } =
    useNotifications({ limit: 100, channel: "notifications-page" });

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.type === 'trial_ending' || n.type === 'trial_ended') {
        router.push('/settings?tab=billing');
      } else if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      } else if (n.contact_id) {
        router.push(`/contacts?open=${n.contact_id}`);
      }
    },
    [markRead, router],
  );

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadIds.length === 0 || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          {t("markAllRead")}
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("emptyDesc")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationItem
                notification={n}
                actorName={n.actor_user_id ? actorNames[n.actor_user_id] : undefined}
                contactName={n.contact_id ? contactNames[n.contact_id] : undefined}
                onClick={handleClick}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
