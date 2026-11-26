"use client";

import { useEffect, useState } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { fetchAgents, type AgentDto } from "@/lib/ai/agents-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The account's agents for the current session (cached in agents-client). */
export function useAiAgents(): AgentDto[] {
  const { accountId } = useAuth();
  const [agents, setAgents] = useState<AgentDto[]>([]);
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    void fetchAgents(accountId).then((a) => alive && setAgents(a));
    return () => {
      alive = false;
    };
  }, [accountId]);
  return agents;
}

/**
 * Conversation header control: which AI agent answers this thread.
 * "Automatic" follows the routing rules (channel, then the default
 * agent). Only shown when the workspace has more than one agent.
 */
export function AiAgentPicker({
  conversationId,
  value,
  agents,
  onChange,
}: {
  conversationId: string;
  value: string | null;
  agents: AgentDto[];
  onChange: (agentId: string | null) => void;
}) {
  const t = useTranslations("Inbox.aiAgent");
  const [busy, setBusy] = useState(false);
  if (agents.length < 2) return null;

  const current = value ? agents.find((a) => a.id === value) : null;

  const pick = async (agentId: string | null) => {
    if (agentId === value) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}/agent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return void toast.error(j?.error ?? t("updateFailed"));
      }
      onChange(agentId);
    } catch {
      toast.error(t("updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        className={cn(
          "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted",
          current ? "text-primary" : "text-muted-foreground",
        )}
        title={t("title")}
      >
        <Bot className="h-3 w-3" />
        <span className="hidden max-w-[120px] truncate sm:inline">{current ? current.name : t("automatic")}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        <DropdownMenuItem onClick={() => pick(null)} className="text-sm">
          <span className="flex-1">{t("automatic")}</span>
          {!value && <Check className="ml-2 h-3 w-3" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        {agents.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onClick={() => pick(a.id)}
            disabled={!a.is_active}
            className={cn("text-sm", a.id === value ? "text-primary" : "text-popover-foreground")}
          >
            <span className="flex-1">
              {a.name}
              {!a.is_active && <span className="ml-1 text-muted-foreground">{t("inactive")}</span>}
            </span>
            {a.id === value && <Check className="ml-2 h-3 w-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
