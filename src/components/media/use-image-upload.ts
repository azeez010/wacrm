"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { ImageRejectedError, uploadToLibrary } from "@/lib/media/library-client";
import { LIBRARY_MAX_BYTES, mimeLabels, validateImage, type MediaAsset } from "@/lib/media/library";

export interface UploadedImage {
  url: string;
  /** Present when the file went into the account library. */
  asset?: MediaAsset;
}

/** A custom destination for pickers that must not use the shared library (e.g. per-user avatars). */
export type ImageUploader = (file: File) => Promise<{ url: string }>;

/**
 * One upload path for the picker field and its modal: validates, uploads (to the
 * library, or through `uploader`), reports problems with a toast and returns
 * the result, or null when nothing was uploaded.
 */
export function useImageUpload(opts: { uploader?: ImageUploader; maxBytes?: number; allowedTypes?: readonly string[] }) {
  const t = useTranslations("MediaPicker");
  const { user, accountId } = useAuth();
  const [uploading, setUploading] = useState(false);
  const { uploader, allowedTypes } = opts;
  const maxBytes = opts.maxBytes ?? LIBRARY_MAX_BYTES;

  const upload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      const rejected = validateImage(file, maxBytes, allowedTypes);
      if (rejected) {
        toast.error(
          rejected === "type"
            ? t("wrongType", { types: mimeLabels(allowedTypes) })
            : t("tooLarge", { size: (file.size / 1024 / 1024).toFixed(1), max: Math.round(maxBytes / 1024 / 1024) }),
        );
        return null;
      }
      setUploading(true);
      try {
        if (uploader) return { url: (await uploader(file)).url };
        if (!user || !accountId) throw new Error(t("notSignedIn"));
        const asset = await uploadToLibrary(file, { accountId, userId: user.id }, allowedTypes);
        return { url: asset.url, asset };
      } catch (err) {
        if (err instanceof ImageRejectedError) {
          toast.error(err.reason === "type" ? t("wrongType", { types: mimeLabels(allowedTypes) }) : t("tooLarge", { size: (file.size / 1024 / 1024).toFixed(1), max: Math.round(maxBytes / 1024 / 1024) }));
        } else {
          toast.error(err instanceof Error ? err.message : t("uploadFailed"));
        }
        return null;
      } finally {
        setUploading(false);
      }
    },
    [uploader, maxBytes, allowedTypes, user, accountId, t],
  );

  return { upload, uploading };
}
