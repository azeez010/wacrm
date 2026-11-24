// ============================================================
// Image library - pure helpers (no I/O), shared by the browser data layer
// and unit tests. See migration 085_media_library.sql.
// ============================================================

export const LIBRARY_BUCKET = 'media-library';

/** Matches the bucket's file_size_limit and Meta's image cap. */
export const LIBRARY_MAX_BYTES = 5 * 1024 * 1024;

/** Raster formats only: SVG can carry script and the bucket is public. */
export const LIBRARY_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Anything larger is scaled down in the browser before upload. */
export const LIBRARY_MAX_DIMENSION = 2560;

export const LIBRARY_ACCEPT = LIBRARY_MIME_TYPES.join(',');

export type ImageRejection = 'type' | 'size';

export function validateImage(
  file: { type: string; size: number },
  maxBytes: number = LIBRARY_MAX_BYTES,
  allowed: readonly string[] = LIBRARY_MIME_TYPES,
): ImageRejection | null {
  if (!allowed.includes(file.type)) return 'type';
  if (file.size > maxBytes) return 'size';
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** `account-<id>/<id>.<ext>` - the extension comes from the MIME type, never the file name. */
export function libraryPath(accountId: string, mime: string, id: string): string {
  return `account-${accountId}/${id}.${EXT_BY_MIME[mime] ?? 'bin'}`;
}

/** Scale `w x h` to fit inside `max` on the longest side, keeping the aspect ratio. */
export function fitWithin(
  width: number,
  height: number,
  max: number = LIBRARY_MAX_DIMENSION,
): { width: number; height: number; scaled: boolean } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, scaled: false };
  const ratio = max / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const LABEL_BY_MIME: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
};

/** "PNG, JPG" style list for hints, from MIME types. */
export function mimeLabels(allowed: readonly string[] = LIBRARY_MIME_TYPES): string {
  return allowed.map((m) => LABEL_BY_MIME[m] ?? m).join(', ');
}

/** First image file in a drag/drop or file-input list, or null. */
export function firstImageFile(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    if (files[i].type.startsWith('image/')) return files[i];
  }
  return files.length > 0 ? files[0] : null;
}

/** https:// URL check for the "paste a link" input. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export interface MediaAsset {
  id: string;
  account_id: string;
  uploaded_by: string | null;
  path: string;
  url: string;
  name: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
}
