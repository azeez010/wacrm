"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * One-shot "open this dialog" deep link. When the URL carries `?<param>=1`
 * (and `enabled` is true), runs `onTrigger` once and strips the param so a
 * refresh doesn't reopen it. The command palette (Cmd/Ctrl+K) and dashboard
 * quick actions use these links to open create-dialogs on other pages.
 *
 * Pass `enabled=false` while the page isn't ready (data loading, or the
 * user's role can't perform the action); the param is kept until it is.
 */
export function useUrlAction(
  param: string,
  onTrigger: () => void,
  enabled = true,
): void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get(param) === "1";

  useEffect(() => {
    if (!active || !enabled) return;
    onTrigger();
    const next = new URLSearchParams(searchParams.toString());
    next.delete(param);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // onTrigger identity changes every render; only the flags drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled]);
}
