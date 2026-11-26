"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Plus, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { AccountRole } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Full page load into the dashboard: the auth context, RLS-scoped queries and
 * realtime channels must all re-read the new active workspace, which a
 * client-side navigation would not do.
 */
function reloadIntoWorkspace() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a hard reload is the point (see above)
  window.location.assign("/dashboard");
}

interface Workspace {
  id: string;
  name: string;
  role: AccountRole;
}

/**
 * Workspace switcher (multi-workspace, migrations 116-121). Lists every
 * workspace the person belongs to (their own `account_members` rows, which
 * RLS limits to them), switches the active one with the `switch_account`
 * RPC and creates new ones with `create_workspace`. Both change which
 * workspace the whole app, RLS and realtime act on, so they finish with a
 * full page load rather than a client-side state update.
 */
export function WorkspaceSwitcher({
  roleLabel,
}: {
  /** Rendered after the active workspace name (the role chip). */
  roleLabel?: React.ReactNode;
}) {
  const t = useTranslations("Sidebar");
  const { user, profile, account } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const load = async (userId: string | undefined) => {
    if (!userId) return;
    const { data, error } = await createClient()
      .from("account_members")
      .select("account_id, account_role, accounts(name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) return;
    setWorkspaces(
      (data ?? []).map((row) => {
        const acc = row.accounts as { name?: string } | { name?: string }[] | null;
        const accName = Array.isArray(acc) ? acc[0]?.name : acc?.name;
        return { id: row.account_id as string, name: accName ?? "", role: row.account_role as AccountRole };
      }),
    );
  };

  // Initial list; it is refreshed again whenever the menu opens.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) return;
    void (async () => {
      const { data, error } = await createClient()
        .from("account_members")
        .select("account_id, account_role, accounts(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (cancelled || error) return;
      setWorkspaces(
        (data ?? []).map((row) => {
          const acc = row.accounts as { name?: string } | { name?: string }[] | null;
          const accName = Array.isArray(acc) ? acc[0]?.name : acc?.name;
          return { id: row.account_id as string, name: accName ?? "", role: row.account_role as AccountRole };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const activeId = account?.id ?? profile?.account_id ?? null;

  const switchTo = async (id: string) => {
    if (id === activeId || busy) return;
    setBusy(true);
    const { error } = await createClient().rpc("switch_account", { p_account: id });
    if (error) {
      toast.error(t("workspaceSwitchFailed"));
      setBusy(false);
      return;
    }
    reloadIntoWorkspace();
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const { error } = await createClient().rpc("create_workspace", { p_name: trimmed });
    if (error) {
      toast.error(t("workspaceCreateFailed"));
      setBusy(false);
      return;
    }
    reloadIntoWorkspace();
  };

  const activeName = account?.name ?? workspaces?.find((w) => w.id === activeId)?.name ?? "";

  return (
    <>
      <DropdownMenu onOpenChange={(o) => o && void load(user?.id)}>
        <DropdownMenuTrigger
          aria-label={t("workspaceSwitch")}
          className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60"
        >
          <UsersRound className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={activeName}>
            {activeName || t("workspace")}
          </span>
          {roleLabel}
          <ChevronsUpDown className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{t("workspaces")}</p>
          {(workspaces ?? []).map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => void switchTo(w.id)} disabled={busy}>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t(`role${w.role.charAt(0).toUpperCase()}${w.role.slice(1)}`)}
              </span>
              {w.id === activeId ? <Check className="size-4 text-primary" /> : <span className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setName("");
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("workspaceNew")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={create} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("workspaceNewTitle")}</DialogTitle>
              <DialogDescription>{t("workspaceNewDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="workspace-name">{t("workspaceName")}</Label>
              <Input
                id="workspace-name"
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workspaceNamePlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {t("workspaceCreate")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
