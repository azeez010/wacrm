"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, MoreVertical } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WIDGET_SIZE, WIDGET_SPAN, type WidgetId } from "@/lib/dashboard/layout";
import { cn } from "@/lib/utils";

/**
 * One draggable dashboard card. The card itself is untouched; a small
 * toolbar on its top edge carries the drag handle (the only drag
 * target, so clicks and scrolling inside the card keep working) and a
 * menu to hide it. The toolbar shows on hover/focus, always on touch.
 */
export function WidgetFrame({
  id,
  onHide,
  children,
}: {
  id: WidgetId;
  onHide: (id: WidgetId) => void;
  children: ReactNode;
}) {
  const t = useTranslations("Dashboard.overview.layout");
  const name = t(`names.${id}`);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/widget relative min-w-0 [&>*:last-child]:h-full",
        WIDGET_SPAN[WIDGET_SIZE[id]],
        isDragging && "z-20 opacity-80 [&>*:last-child]:shadow-xl [&>*:last-child]:ring-2 [&>*:last-child]:ring-primary/40",
      )}
    >
      <div
        className={cn(
          "absolute -top-3 right-3 z-10 flex items-center rounded-md border border-border bg-card/95 shadow-sm backdrop-blur transition-opacity",
          "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/widget:opacity-100 [@media(hover:hover)]:group-focus-within/widget:opacity-100",
          isDragging && "opacity-100",
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("dragHandle", { name })}
          title={t("dragHandle", { name })}
          className="flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded-l-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("cardMenu", { name })}
            className="flex h-6 w-6 items-center justify-center rounded-r-md border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onHide(id)}>
              <EyeOff aria-hidden />
              {t("hide")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children}
    </div>
  );
}
