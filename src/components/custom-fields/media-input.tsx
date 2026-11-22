'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileText, Loader2, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deleteAccountMedia, uploadAccountMedia } from '@/lib/storage/upload-media';
import {
  MEDIA_FIELD_BUCKET,
  MEDIA_FIELD_MAX_BYTES,
  MEDIA_FIELD_SUBFOLDER,
  acceptAttribute,
  acceptsMime,
  kindFromMime,
  parseMediaValue,
} from '@/lib/custom-fields/media';
import type { MediaAccept } from '@/lib/custom-fields/types';

interface MediaInputProps {
  /** Canonical value: JSON text of a MediaValue, or '' when empty. */
  value: string;
  onChange: (value: string) => void;
  accept?: MediaAccept;
  disabled?: boolean;
  className?: string;
}

/**
 * One-file picker for media custom fields. Uploads straight to the
 * account's folder in storage and hands back a JSON description of the
 * file. A file uploaded in this editing session but then replaced or
 * removed before saving is deleted again, so abandoned uploads don't pile up.
 */
export function MediaInput({ value, onChange, accept, disabled, className }: MediaInputProps) {
  const t = useTranslations('CustomFields.media');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Paths uploaded in this session and not yet known to be saved.
  const staged = useRef<Set<string>>(new Set());

  const parsed = value ? parseMediaValue(value) : null;
  const current = parsed?.ok ? parsed.value : null;

  function discardIfStaged(path: string | undefined) {
    if (path && staged.current.has(path)) {
      staged.current.delete(path);
      void deleteAccountMedia(MEDIA_FIELD_BUCKET, path).catch(() => undefined);
    }
  }

  async function handleFile(file: File) {
    if (!acceptsMime(accept, file.type)) {
      toast.error(t('wrongType', { accept: t(`accept.${accept ?? 'any'}`) }));
      return;
    }
    const kind = kindFromMime(file.type);
    const max = MEDIA_FIELD_MAX_BYTES[kind];
    if (file.size > max) {
      toast.error(t('tooLarge', { size: (file.size / 1024 / 1024).toFixed(1), max: Math.round(max / 1024 / 1024) }));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(MEDIA_FIELD_BUCKET, file, MEDIA_FIELD_SUBFOLDER);
      discardIfStaged(current?.path);
      staged.current.add(path);
      onChange(JSON.stringify({ url: publicUrl, path, name: file.name, mime: file.type, size: file.size }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      {current ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1.5 text-xs">
          {kindFromMime(current.mime) === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.url} alt="" className="size-8 shrink-0 rounded object-cover" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          )}
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            title={current.name}
            className="min-w-0 flex-1 truncate text-foreground hover:underline"
          >
            {current.name}
          </a>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                discardIfStaged(current.path);
                onChange('');
              }}
              disabled={uploading}
              aria-label={t('remove')}
              title={t('remove')}
              className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t('uploading')}
            </>
          ) : (
            <>
              <Upload className="size-3.5" />
              {t('upload')}
            </>
          )}
        </button>
      )}
      {current && !disabled && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {uploading ? t('uploading') : t('replace')}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttribute(accept)}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
