// ============================================================
// Image library - browser data layer (Supabase Storage + media_assets).
// Uploads go straight from the browser with the user's session, so large
// files never pass through the Worker. RLS in migration 085 decides who
// may upload, read and delete.
// ============================================================

import { createClient } from '@/lib/supabase/client';
import {
  LIBRARY_BUCKET,
  LIBRARY_MAX_DIMENSION,
  fitWithin,
  libraryPath,
  validateImage,
  type MediaAsset,
} from '@/lib/media/library';

export class ImageRejectedError extends Error {
  constructor(public reason: 'type' | 'size') {
    super(reason);
  }
}

const LIST_LIMIT = 200;

function loadBitmap(file: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image'));
    };
    img.src = url;
  });
}

/**
 * Read the image size and, when it is larger than LIBRARY_MAX_DIMENSION on its
 * longest side, shrink it in the browser. GIFs are left alone (re-encoding would
 * drop the animation).
 */
async function prepare(file: File): Promise<{ file: File; width: number; height: number }> {
  const bmp = await loadBitmap(file);
  const fit = fitWithin(bmp.width, bmp.height, LIBRARY_MAX_DIMENSION);
  if (!fit.scaled || file.type === 'image/gif') {
    return { file, width: bmp.width, height: bmp.height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file, width: bmp.width, height: bmp.height };
  bmp.draw(ctx, fit.width, fit.height);
  const type = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, type, 0.9));
  if (!blob || blob.size >= file.size) return { file, width: bmp.width, height: bmp.height };
  return { file: new File([blob], file.name, { type }), width: fit.width, height: fit.height };
}

/**
 * Upload an image to the account's library and record it. Throws
 * ImageRejectedError for a wrong type or size (checked before and after any
 * downscale), otherwise an Error with a message safe to show.
 */
export async function uploadToLibrary(
  file: File,
  ctx: { accountId: string; userId: string },
  allowedTypes?: readonly string[],
): Promise<MediaAsset> {
  const rejected = validateImage(file, undefined, allowedTypes);
  if (rejected) throw new ImageRejectedError(rejected);

  const prepared = await prepare(file);
  const again = validateImage(prepared.file, undefined, allowedTypes);
  if (again) throw new ImageRejectedError(again);

  const supabase = createClient();
  const path = libraryPath(ctx.accountId, prepared.file.type, crypto.randomUUID());

  const { error: upErr } = await supabase.storage.from(LIBRARY_BUCKET).upload(path, prepared.file, {
    cacheControl: '31536000',
    upsert: false,
    contentType: prepared.file.type,
  });
  if (upErr) throw new Error(upErr.message);

  const {
    data: { publicUrl },
  } = supabase.storage.from(LIBRARY_BUCKET).getPublicUrl(path);

  const { data, error } = await supabase
    .from('media_assets')
    .insert({
      account_id: ctx.accountId,
      uploaded_by: ctx.userId,
      path,
      url: publicUrl,
      name: file.name.slice(0, 120),
      mime: prepared.file.type,
      size_bytes: prepared.file.size,
      width: prepared.width,
      height: prepared.height,
    })
    .select('*')
    .single();

  if (error || !data) {
    // Don't leave an unlisted file behind.
    await supabase.storage.from(LIBRARY_BUCKET).remove([path]).catch(() => undefined);
    throw new Error(error?.message ?? 'Could not save the image');
  }
  return data as MediaAsset;
}

export async function listLibrary(accountId: string): Promise<MediaAsset[]> {
  const { data, error } = await createClient()
    .from('media_assets')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as MediaAsset[];
}

/** Remove the row first (RLS decides who may), then the file. */
export async function deleteFromLibrary(asset: MediaAsset): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.from('media_assets').delete().eq('id', asset.id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error('Not allowed to delete this image');
  await supabase.storage.from(LIBRARY_BUCKET).remove([asset.path]).catch(() => undefined);
}

/** How many forms currently use this image as logo, background or share image. */
export async function countFormsUsing(accountId: string, url: string): Promise<number> {
  const quoted = `"${url.replace(/"/g, '')}"`;
  const { count } = await createClient()
    .from('forms')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('archived_at', null)
    .or(`settings->>logoUrl.eq.${quoted},settings->>backgroundImage.eq.${quoted},settings->>ogImage.eq.${quoted}`);
  return count ?? 0;
}
