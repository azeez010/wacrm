"use client";

import { useEffect, useRef } from "react";
import { stripUnreadPrefix, withUnreadPrefix } from "@/lib/inbox/unread-title";

/**
 * Keeps "(n) " in front of the tab title, where n is the number of
 * unread conversations. Next rewrites <title> on navigation, so a
 * MutationObserver re-applies the badge whenever the title changes.
 */
export function useUnreadTitle(count: number): void {
  const countRef = useRef(count);

  useEffect(() => {
    countRef.current = count;
    const next = withUnreadPrefix(document.title, count);
    if (next !== document.title) document.title = next;
  }, [count]);

  useEffect(() => {
    const apply = () => {
      const next = withUnreadPrefix(document.title, countRef.current);
      // Guard: our own write triggers the observer again; no-op then.
      if (next !== document.title) document.title = next;
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      document.title = stripUnreadPrefix(document.title);
    };
  }, []);
}
