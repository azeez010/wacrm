"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_LAYOUT,
  moveWidget,
  parseLayout,
  setHidden,
  type DashboardLayout,
  type WidgetId,
} from "@/lib/dashboard/layout";

const CHANGE_EVENT = "ogadesk:dashboard-layout-change";

const keyFor = (userId: string | null | undefined) =>
  `ogadesk:dashboard-layout:v1:${userId ?? "anon"}`;

// useSyncExternalStore needs a stable snapshot: cache by key + raw string.
let cachedKey: string | null = null;
let cachedRaw: string | null | undefined;
let cachedLayout: DashboardLayout = DEFAULT_LAYOUT;

function read(key: string): DashboardLayout {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }
  if (key !== cachedKey || raw !== cachedRaw) {
    cachedKey = key;
    cachedRaw = raw;
    cachedLayout = parseLayout(raw);
  }
  return cachedLayout;
}

function write(key: string, layout: DashboardLayout | null): void {
  try {
    if (layout) window.localStorage.setItem(key, JSON.stringify(layout));
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode / blocked storage: the change still applies until reload.
    cachedKey = key;
    cachedRaw = undefined;
    cachedLayout = layout ?? DEFAULT_LAYOUT;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("ogadesk:dashboard-layout:")) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The dashboard card layout for this user on this device (order +
 * hidden cards), kept in localStorage and synced across tabs.
 */
export function useDashboardLayout(userId: string | null | undefined) {
  const key = keyFor(userId);
  const layout = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => DEFAULT_LAYOUT,
  );

  const move = useCallback(
    (activeId: WidgetId, overId: WidgetId) => write(key, moveWidget(read(key), activeId, overId)),
    [key],
  );
  const hide = useCallback((id: WidgetId) => write(key, setHidden(read(key), id, true)), [key]);
  const show = useCallback((id: WidgetId) => write(key, setHidden(read(key), id, false)), [key]);
  const reset = useCallback(() => write(key, null), [key]);

  return { layout, move, hide, show, reset };
}
