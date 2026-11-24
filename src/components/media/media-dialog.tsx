"use client";

// The picker modal: an Upload tab (drag and drop, browse, or paste a link) and
// a Library tab with every image this account has uploaded.

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ImageIcon, Link2, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { countFormsUsing, deleteFromLibrary, listLibrary } from "@/lib/media/library-client";
import { LIBRARY_ACCEPT, firstImageFile, formatBytes, isHttpsUrl, mimeLabels, type MediaAsset } from "@/lib/media/library";
import { useImageUpload, type ImageUploader, type UploadedImage } from "./use-image-upload";

interface MediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl?: string | null;
  library: boolean;
  uploader?: ImageUploader;
  maxBytes?: number;
  /** Restrict to these MIME types (defaults to PNG, JPG, WebP, GIF). */
  allowedTypes?: readonly string[];
  /** Offer "paste an image link". Off where the stored value needs a library file. */
  allowLink?: boolean;
  onPick: (url: string, asset?: MediaAsset) => void;
}

export function MediaDialog({ open, onOpenChange, currentUrl, library, uploader, maxBytes, allowedTypes, allowLink = true, onPick }: MediaDialogProps) {
  const t = useTranslations("MediaPicker");
  const { user, accountId, accountRole } = useAuth();
  const { upload, uploading } = useImageUpload({ uploader, maxBytes, allowedTypes });

  const [tab, setTab] = useState<"upload" | "library">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<MediaAsset[] | null>(null);
  const [loadingLib, setLoadingLib] = useState(false);
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  const [confirm, setConfirm] = useState<{ asset: MediaAsset; forms: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const close = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) {
        setTab("upload");
        setLink("");
        setSelected(null);
        setConfirm(null);
        setDragOver(false);
      }
    },
    [onOpenChange],
  );

  // Load the library the first time its tab is opened.
  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoadingLib(true);
    try {
      setAssets(await listLibrary(accountId));
    } catch {
      toast.error(t("libraryFailed"));
      setAssets([]);
    } finally {
      setLoadingLib(false);
    }
  }, [accountId, t]);

  function changeTab(next: "upload" | "library") {
    setTab(next);
    if (next === "library" && assets === null) void refresh();
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    const result: UploadedImage | null = await upload(file);
    if (!result) return;
    if (result.asset) setAssets((prev) => (prev ? [result.asset!, ...prev] : prev));
    onPick(result.url, result.asset);
    close(false);
  }

  function applyLink() {
    const v = link.trim();
    if (!isHttpsUrl(v)) {
      toast.error(t("invalidLink"));
      return;
    }
    onPick(v);
    close(false);
  }

  const isAdmin = accountRole === "owner" || accountRole === "admin";
  const canDelete = (a: MediaAsset) => isAdmin || (!!user && a.uploaded_by === user.id);

  async function askDelete(asset: MediaAsset) {
    const forms = accountId ? await countFormsUsing(accountId, asset.url).catch(() => 0) : 0;
    setConfirm({ asset, forms });
  }

  async function runDelete() {
    if (!confirm) return;
    setDeleting(true);
    try {
      await deleteFromLibrary(confirm.asset);
      setAssets((prev) => (prev ? prev.filter((a) => a.id !== confirm.asset.id) : prev));
      if (selected?.id === confirm.asset.id) setSelected(null);
      toast.success(t("deleted"));
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  const dropZone = (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("dropAria")}
      onClick={() => !uploading && fileRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !uploading) {
          e.preventDefault();
          fileRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFile(firstImageFile(e.dataTransfer.files));
      }}
      className={cn(
        "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
        dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
      )}
    >
      {uploading ? (
        <>
          <Loader2 className="text-primary size-6 animate-spin" />
          <p className="text-sm">{t("uploading")}</p>
        </>
      ) : (
        <>
          <Upload className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">{t("dropHere")}</p>
          <p className="text-muted-foreground text-xs">{t("dropHint", { types: mimeLabels(allowedTypes), max: Math.round((maxBytes ?? 5 * 1024 * 1024) / 1024 / 1024) })}</p>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={allowedTypes ? allowedTypes.join(",") : LIBRARY_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void handleFile(firstImageFile(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );

  const linkRow = !allowLink ? null : (
    <div className="mt-4">
      <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs">
        <Link2 className="size-3.5" />
        {t("orLink")}
      </p>
      <div className="flex gap-2">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyLink())} />
        <Button type="button" variant="outline" onClick={applyLink} disabled={!link.trim()}>
          {t("useLink")}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !deleting && close(o)}>
      <DialogContent className="sm:max-w-2xl">
        {confirm ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("deleteTitle")}</DialogTitle>
              <DialogDescription>
                {confirm.forms > 0 ? t("usedBy", { count: confirm.forms }) : t("deleteBody")} {t("deleteElsewhere")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-3 rounded-md border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={confirm.asset.url} alt="" className="size-14 rounded object-cover" />
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{confirm.asset.name}</p>
                <p className="text-muted-foreground text-xs">{formatBytes(confirm.asset.size_bytes)}</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={deleting} onClick={() => setConfirm(null)}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" disabled={deleting} onClick={() => void runDelete()}>
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("delete")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{library ? t("description") : t("descriptionUploadOnly")}</DialogDescription>
            </DialogHeader>

            {library ? (
              <Tabs value={tab} onValueChange={(v) => changeTab(v as "upload" | "library")}>
                <TabsList>
                  <TabsTrigger value="upload">{t("tabUpload")}</TabsTrigger>
                  <TabsTrigger value="library">{t("tabLibrary")}</TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="mt-3">
                  {dropZone}
                  {linkRow}
                </TabsContent>

                <TabsContent value="library" className="mt-3">
                  {loadingLib || assets === null ? (
                    <div className="flex min-h-44 items-center justify-center">
                      <Loader2 className="text-primary size-5 animate-spin" />
                    </div>
                  ) : assets.length === 0 ? (
                    <div className="text-muted-foreground flex min-h-44 flex-col items-center justify-center gap-2 text-center text-sm">
                      <ImageIcon className="size-6" />
                      <p>{t("libraryEmpty")}</p>
                      <Button variant="outline" size="sm" onClick={() => changeTab("upload")}>
                        {t("tabUpload")}
                      </Button>
                    </div>
                  ) : (
                    <ul className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-4">
                      {assets.filter((a) => !allowedTypes || allowedTypes.includes(a.mime)).map((a) => {
                        const isSelected = selected?.id === a.id;
                        const isCurrent = a.url === currentUrl;
                        return (
                          <li key={a.id} className="group relative">
                            <button
                              type="button"
                              onClick={() => setSelected(a)}
                              onDoubleClick={() => {
                                onPick(a.url, a);
                                close(false);
                              }}
                              aria-pressed={isSelected}
                              title={`${a.name} · ${formatBytes(a.size_bytes)}`}
                              className={cn(
                                "bg-muted block aspect-square w-full overflow-hidden rounded-md ring-offset-2 ring-offset-background transition",
                                isSelected ? "ring-primary ring-2" : "hover:ring-border hover:ring-2",
                              )}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
                              {isSelected ? (
                                <span className="bg-primary text-primary-foreground absolute top-1 left-1 grid size-5 place-items-center rounded-full">
                                  <Check className="size-3.5" />
                                </span>
                              ) : null}
                              {isCurrent ? (
                                <span className="bg-background/90 absolute right-1 bottom-1 rounded px-1.5 py-0.5 text-[10px] font-medium">{t("inUse")}</span>
                              ) : null}
                            </button>
                            {canDelete(a) ? (
                              <button
                                type="button"
                                onClick={() => void askDelete(a)}
                                aria-label={t("deleteAria", { name: a.name })}
                                className="bg-background/90 text-muted-foreground hover:text-destructive absolute top-1 right-1 rounded p-1 opacity-0 shadow-sm transition group-focus-within:opacity-100 group-hover:opacity-100"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <div>
                {dropZone}
                {linkRow}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>
                {t("cancel")}
              </Button>
              {library && tab === "library" ? (
                <Button
                  disabled={!selected}
                  onClick={() => {
                    if (!selected) return;
                    onPick(selected.url, selected);
                    close(false);
                  }}
                >
                  {t("select")}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
