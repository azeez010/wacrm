"use client";

import { use, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Settings2, Share2 } from "lucide-react";

import { PublicForm } from "@/components/public-form/public-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { editorReducer, initialState, isDirty } from "@/components/forms/editor-state";
import { FieldList } from "@/components/forms/field-list";
import { buildPreviewConfig } from "@/components/forms/preview-config";
import { Results } from "@/components/forms/results";
import { SettingsSheet } from "@/components/forms/settings-sheet";
import { ShareDialog } from "@/components/forms/share-dialog";
import { SupportEditor } from "@/components/forms/support-editor";
import { useFormEditorData } from "@/components/forms/use-form-data";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { createClient } from "@/lib/supabase/client";
import { parseFormFields, parseFormSettings, type FormKind } from "@/lib/forms/types";

interface FormMeta {
  id: string;
  public_id: string;
  kind: FormKind;
}

export default function FormEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("Forms.editor");
  const router = useRouter();
  const { accountId } = useAuth();
  const canEdit = useCan("manage-forms");
  const data = useFormEditorData(accountId);
  const [state, dispatch] = useReducer(editorReducer, undefined, initialState);
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [tab, setTab] = useState<"edit" | "results">("edit");
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    void (async () => {
      const { data: row } = await createClient()
        .from("forms")
        .select("id, public_id, kind, name, status, fields, settings")
        .eq("id", id)
        .maybeSingle();
      if (!row) return router.replace("/forms");
      setMeta({ id: row.id, public_id: row.public_id, kind: row.kind });
      dispatch({
        type: "load",
        name: row.name,
        status: row.status,
        fields: parseFormFields(row.fields),
        settings: parseFormSettings(row.settings),
      });
    })();
  }, [id, router]);

  const save = useCallback(
    async (override?: { status?: "draft" | "active" | "paused" }): Promise<boolean> => {
      setSaving(true);
      const res = await fetch(`/api/forms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.name, status: override?.status ?? state.status, fields: state.fields, settings: state.settings }),
      });
      setSaving(false);
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("saveFailed"));
        return false;
      }
      dispatch({ type: "markSaved" });
      return true;
    },
    [id, state.name, state.status, state.fields, state.settings, t],
  );

  const config = useMemo(
    () => (meta ? buildPreviewConfig(meta.public_id, meta.kind, state.name, state.fields, state.settings, data) : null),
    [meta, state.name, state.fields, state.settings, data],
  );

  if (!meta || !config) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const dirty = isDirty(state);
  const active = state.status === "active";
  const isSupport = meta.kind === "support";

  async function togglePublish(on: boolean) {
    const next = on ? "active" : "paused";
    dispatch({ type: "status", status: next });
    if (!(await save({ status: next }))) dispatch({ type: "status", status: state.status });
    else if (on) setShareOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("back")} onClick={() => router.push("/forms")}>
          <ArrowLeft className="size-4" />
        </Button>
        <Input value={state.name} disabled={!canEdit} onChange={(e) => dispatch({ type: "name", name: e.target.value })} className="h-9 max-w-xs font-medium" maxLength={120} aria-label={t("name")} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} disabled={!canEdit || saving} onCheckedChange={(on) => void togglePublish(on)} />
            {active ? t("published") : t("publish")}
          </label>
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} disabled={!active && state.status === "draft"}>
            <Share2 className="size-4" />
            {t("share")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
            {t("settings")}
          </Button>
          <Button size="sm" disabled={!canEdit || !dirty || saving} onClick={() => void save().then((ok) => ok && toast.success(t("saved")))}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {dirty ? t("save") : t("saved")}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "edit" | "results")}>
        <TabsList>
          <TabsTrigger value="edit">{t("tabEdit")}</TabsTrigger>
          <TabsTrigger value="results">{t("tabResults")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "results" ? (
        <Results formId={meta.id} fields={state.fields} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            {isSupport ? (
              <SupportEditor fields={state.fields} settings={state.settings} canEdit={canEdit} dispatch={dispatch} />
            ) : (
              <FieldList fields={state.fields} data={data} qualifyOn={state.settings.qualification.enabled} canEdit={canEdit} dispatch={dispatch} />
            )}
          </div>
          <div>
            {!isSupport && (
              <div className="mb-2 flex justify-end gap-1">
                {(["desktop", "mobile"] as const).map((d) => (
                  <Button key={d} size="sm" variant={device === d ? "default" : "outline"} onClick={() => setDevice(d)}>
                    {t(d)}
                  </Button>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-dashed border-border bg-muted/40 p-4">
              <div className={device === "mobile" || isSupport ? "mx-auto max-w-[22rem]" : ""}>
                <PublicForm key={meta.id} config={config} embedded={isSupport} preview />
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">{t("previewHint")}</p>
          </div>
        </div>
      )}

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} kind={meta.kind} publicId={meta.public_id} />
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        kind={meta.kind}
        settings={state.settings}
        data={data}
        canEdit={canEdit}
        patch={(p) => dispatch({ type: "settings", patch: p })}
      />
    </div>
  );
}
