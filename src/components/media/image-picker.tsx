"use client";

// ============================================================
// ImagePicker - the one reusable way to choose an image.
//
// Empty: a single "Upload" button (you can also drop a file on it). Filled:
// a thumbnail with Replace and an x that clears the field. Clearing never
// deletes the file; deleting happens in the modal's Library tab, after a
// confirmation. The value is a plain URL, so anything that stores an image
// URL can use it:
//
//   <ImagePicker value={s.logoUrl} onChange={(url) => patch({ logoUrl: url ?? undefined })} />
//
// `library={false}` + `uploader` gives an upload-only picker that stores
// somewhere else (the profile photo goes to a per-user bucket).
// ============================================================

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { firstImageFile, type MediaAsset } from "@/lib/media/library";
import { MediaDialog } from "./media-dialog";
import { useImageUpload, type ImageUploader } from "./use-image-upload";

export interface ImagePickerProps {
  value?: string | null;
  /** `null` when cleared. `asset` is set when the image came from the library. */
  onChange: (url: string | null, asset?: MediaAsset) => void;
  /** Show the account's image library tab. Default true. */
  library?: boolean;
  /** Store somewhere other than the shared library (use with `library={false}`). */
  uploader?: ImageUploader;
  maxBytes?: number;
  /** Restrict to these MIME types, e.g. Meta template headers accept only JPEG and PNG. */
  allowedTypes?: readonly string[];
  /** Offer "paste an image link" in the modal. Default true. */
  allowLink?: boolean;
  /** Shape of the preview thumbnail only. */
  shape?: "square" | "wide" | "round";
  disabled?: boolean;
  className?: string;
}

const THUMB: Record<NonNullable<ImagePickerProps["shape"]>, string> = {
  square: "size-14 rounded-md",
  wide: "h-14 w-24 rounded-md",
  round: "size-14 rounded-full",
};

export function ImagePicker({ value, onChange, library = true, uploader, maxBytes, allowedTypes, allowLink = true, shape = "square", disabled, className }: ImagePickerProps) {
  const t = useTranslations("MediaPicker");
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { upload, uploading } = useImageUpload({ uploader, maxBytes, allowedTypes });

  async function onDropFile(files: FileList) {
    const file = firstImageFile(files);
    if (!file) return;
    const result = await upload(file);
    if (result) onChange(result.url, result.asset);
  }

  const dropProps = disabled
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          void onDropFile(e.dataTransfer.files);
        },
      };

  return (
    <div className={cn("w-full", className)}>
      <div {...dropProps} className={cn("rounded-md transition-colors", dragOver && "bg-primary/5 ring-primary ring-2")}>
        {value ? (
          <div className="flex items-center gap-3 rounded-md border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className={cn("bg-muted shrink-0 object-cover", THUMB[shape])} />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => setOpen(true)}>
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t("replace")}
              </Button>
            </div>
            {!disabled ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                aria-label={t("remove")}
                title={t("remove")}
                className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        ) : (
          <Button type="button" variant="outline" disabled={disabled || uploading} onClick={() => setOpen(true)}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t("upload")}
          </Button>
        )}
      </div>

      <MediaDialog
        open={open}
        onOpenChange={setOpen}
        currentUrl={value}
        library={library}
        uploader={uploader}
        maxBytes={maxBytes}
        allowedTypes={allowedTypes}
        allowLink={allowLink}
        onPick={(url, asset) => onChange(url, asset)}
      />
    </div>
  );
}
