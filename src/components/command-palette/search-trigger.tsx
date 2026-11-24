"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

import { OPEN_COMMAND_PALETTE_EVENT } from "./command-palette";

const subscribe = () => () => {};
const isMacClient = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Header search button. Desktop only; opens the Cmd/Ctrl+K palette. */
export function SearchTrigger() {
  const t = useTranslations("CommandPalette");
  const isMac = useSyncExternalStore(subscribe, isMacClient, () => false);

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      aria-label={t("placeholder")}
      className="hidden h-9 w-56 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted lg:flex xl:w-64"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left">{t("trigger")}</span>
      <kbd className="rounded border px-1.5 py-0.5 text-[10px] font-medium">{isMac ? "\u2318K" : "Ctrl K"}</kbd>
    </button>
  );
}
