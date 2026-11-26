"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { readPushActive } from "@/lib/push/client";
import { notificationText } from "@/lib/notifications/notification-text";
import type { Message, Notification as BellNotification } from "@/types";
import {
  DEFAULT_NOTIFICATION_LABELS,
  bellItemHref,
  buildNotificationContent,
  conversationHref,
  getNotificationPermission,
  pickContactDisplayName,
  readBrowserNotifyPref,
  shouldAlertForNotification,
  shouldNotifyForMessage,
  subscribeBrowserNotifyPref,
  viewedConversationFromLocation,
  type NotificationLabels,
} from "@/lib/notifications/browser-notify";
import {
  DEFAULT_SOUND_PREF,
  playSound,
  readSoundPref,
  shouldPlaySound,
  subscribeSoundPref,
  unlockAudioOnGesture,
  type SoundPref,
} from "@/lib/notifications/sound";

const serverSnapshot = () => false;

/**
 * The device-scoped "browser notifications" opt-in, kept in sync with
 * localStorage across this tab (settings toggle) and other tabs.
 */
export function useBrowserNotifyPref(): boolean {
  return useSyncExternalStore(
    subscribeBrowserNotifyPref,
    readBrowserNotifyPref,
    serverSnapshot,
  );
}

const serverSoundSnapshot = (): SoundPref => DEFAULT_SOUND_PREF;

/** The device-scoped new-message sound preference. */
export function useSoundPref(): SoundPref {
  return useSyncExternalStore(subscribeSoundPref, readSoundPref, serverSoundSnapshot);
}

/**
 * Desktop notifications AND the new-message sound for new inbound
 * customer messages. Mount ONCE
 * per signed-in dashboard tab (the dashboard shell does this via
 * <BrowserNotificationsListener />) so alerts fire on any page.
 *
 * Listens for realtime INSERTs on `messages` - RLS scopes the stream to
 * the caller's account, same as useTotalUnread / useRealtime. Only
 * live events are considered: there is no initial fetch, so an existing
 * backlog never produces a burst of alerts on page load.
 *
 * Own channel name so it coexists with the inbox page's subscription
 * and the sidebar's unread counters.
 *
 * Fires only while a dashboard tab is open - there is no service worker
 * or Web Push here, so a closed browser stays quiet.
 */
export function useBrowserNotifications(): void {
  const notifyEnabled = useBrowserNotifyPref();
  const sound = useSoundPref();
  const soundEnabled = sound.enabled;
  const enabled = notifyEnabled || soundEnabled;
  const router = useRouter();
  const t = useTranslations("Settings.browserNotifications.labels");
  const tn = useTranslations("Notifications");
  const { user, accountId } = useAuth();
  const userId = user?.id ?? null;

  // Translated labels, read inside the async Realtime callback. Kept in
  // a ref (assigned in an effect, not during render) so a locale change
  // doesn't tear down and re-open the channel.
  const labelsRef = useRef<NotificationLabels>(DEFAULT_NOTIFICATION_LABELS);
  useEffect(() => {
    labelsRef.current = {
      fallbackTitle: t("fallbackTitle"),
      image: t("image"),
      audio: t("audio"),
      video: t("video"),
      document: t("document"),
      location: t("location"),
      template: t("template"),
    };
  });

  // Message ids already handled, for replay dedupe. Survives re-renders,
  // pruned by shouldNotifyForMessage.
  const seenRef = useRef<Map<string, number>>(new Map());
  const lastSoundAtRef = useRef<number | null>(null);
  // Latest prefs, read inside the realtime callback without re-subscribing.
  const prefsRef = useRef({ notifyEnabled, sound });
  useEffect(() => {
    prefsRef.current = { notifyEnabled, sound };
  });

  useEffect(() => {
    unlockAudioOnGesture();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let cancelled = false;

    const notify = async (msg: Message) => {
      // Background push is on for this device: its banner replaces this one.
      if (readPushActive()) return;
      // One small select to put the contact's name in the title. A
      // failure here just means the generic fallback title.
      const { data } = await supabase
        .from("conversations")
        .select("contact:contacts(name, wa_username, phone)")
        .eq("id", msg.conversation_id)
        .maybeSingle();
      if (cancelled) return;

      const contact = (data as {
        contact?: { name?: string | null; wa_username?: string | null; phone?: string | null } | null;
      } | null)?.contact;
      const { title, body } = buildNotificationContent(
        msg,
        pickContactDisplayName(contact),
        labelsRef.current,
      );

      try {
        const notification = new Notification(title, {
          body,
          // One alert per conversation: a second message from the same
          // customer replaces the first instead of stacking.
          tag: msg.conversation_id,
          // Without renotify a same-tag replacement is silent (no banner).
          renotify: true,
          icon: "/android-chrome-192x192.png",
        } as NotificationOptions);
        notification.onclick = () => {
          window.focus();
          router.push(conversationHref(msg.conversation_id));
          notification.close();
        };
      } catch (err) {
        // Some browsers throw from the constructor (e.g. Android Chrome
        // requires a service worker). Non-fatal.
        console.error("[useBrowserNotifications] failed to show:", err);
      }
    };

    const channel = supabase
      .channel("browser-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          const shouldNotify = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === "visible",
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search,
            ),
            seen: seenRef.current,
          });
          if (!shouldNotify) return;
          const prefs = prefsRef.current;
          if (prefs.sound.enabled) {
            const now = Date.now();
            if (shouldPlaySound(now, lastSoundAtRef.current)) {
              lastSoundAtRef.current = now;
              playSound(prefs.sound.sound, prefs.sound.volume);
            }
          }
          // Re-check every time: the user can revoke permission in the
          // browser without the preference flipping.
          if (prefs.notifyEnabled && getNotificationPermission() === "granted") {
            void notify(msg);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enabled, router]);

  // Bell items (new lead, support request, assignment...) as desktop alerts too, while a tab is open.
  // Realtime only streams this user's own rows (RLS); the tab being visible stays silent (the bell shows it).
  const seenBellRef = useRef<Map<string, number>>(new Map());
  const tnRef = useRef(tn);
  useEffect(() => {
    tnRef.current = tn;
  });
  useEffect(() => {
    if (!notifyEnabled || !userId || !accountId) return;
    const supabase = createClient();
    let cancelled = false;

    const channel = supabase
      .channel(`bell-desktop-alerts:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `account_id=eq.${accountId}` },
        async (payload) => {
          const n = payload.new as BellNotification;
          const show = shouldAlertForNotification(n, {
            userId,
            documentVisible: document.visibilityState === "visible",
            seen: seenBellRef.current,
          });
          if (!show || getNotificationPermission() !== "granted" || readPushActive()) return;

          // Names for the localized assignment text; a failure just means the generic wording.
          let actor: string | undefined;
          let contact: string | undefined;
          if (n.type === "conversation_assigned") {
            const [a, c] = await Promise.all([
              n.actor_user_id ? supabase.from("profiles").select("full_name").eq("user_id", n.actor_user_id).maybeSingle() : null,
              n.contact_id ? supabase.from("contacts").select("name, phone").eq("id", n.contact_id).maybeSingle() : null,
            ]);
            actor = (a?.data as { full_name?: string | null } | null)?.full_name ?? undefined;
            const ct = c?.data as { name?: string | null; phone?: string | null } | null | undefined;
            contact = ct?.name || ct?.phone || undefined;
          }
          if (cancelled) return;
          const copy = notificationText(n, { actor, contact }, tnRef.current);
          try {
            const notification = new Notification(copy.title, {
              body: copy.body,
              tag: `notif-${n.id}`,
              icon: "/android-chrome-192x192.png",
            });
            notification.onclick = () => {
              window.focus();
              router.push(bellItemHref(n));
              notification.close();
            };
          } catch (err) {
            console.error("[useBrowserNotifications] failed to show a bell alert:", err);
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [notifyEnabled, userId, accountId, router]);
}
