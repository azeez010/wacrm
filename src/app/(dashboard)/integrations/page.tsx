"use client";

import { useTranslations } from "next-intl";

import { RequireRole } from "@/components/auth/require-role";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";

// Connect tools the AI can use (MCP servers, HTTP actions, Google Calendar, Paystack links). It used to be a tab in
// Settings (/settings?tab=integrations, which now redirects here).
export default function IntegrationsPage() {
  const t = useTranslations("Settings");
  return (
    <div className="max-w-5xl">
      <RequireRole min="admin" fallback={<p className="text-muted-foreground text-sm">{t("adminOnlySection")}</p>}>
        <IntegrationsPanel />
      </RequireRole>
    </div>
  );
}
