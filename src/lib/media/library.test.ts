import { describe, expect, it } from 'vitest';

import {
  LIBRARY_MAX_BYTES,
  fitWithin,
  firstImageFile,
  formatBytes,
  isHttpsUrl,
  libraryPath,
  mimeLabels,
  validateImage,
} from './library';

describe('validateImage', () => {
  it('accepts raster images within the limit', () => {
    expect(validateImage({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateImage({ type: 'image/webp', size: LIBRARY_MAX_BYTES })).toBeNull();
  });
  it('rejects other types (including SVG and PDF)', () => {
    expect(validateImage({ type: 'image/svg+xml', size: 10 })).toBe('type');
    expect(validateImage({ type: 'application/pdf', size: 10 })).toBe('type');
  });
  it('honours a narrower allowed list (e.g. Meta template headers: JPEG/PNG only)', () => {
    expect(validateImage({ type: 'image/webp', size: 10 }, LIBRARY_MAX_BYTES, ['image/jpeg', 'image/png'])).toBe('type');
    expect(validateImage({ type: 'image/png', size: 10 }, LIBRARY_MAX_BYTES, ['image/jpeg', 'image/png'])).toBeNull();
    expect(mimeLabels(['image/jpeg', 'image/png'])).toBe('JPG, PNG');
  });
  it('rejects files over the limit and honours a custom limit', () => {
    expect(validateImage({ type: 'image/png', size: LIBRARY_MAX_BYTES + 1 })).toBe('size');
    expect(validateImage({ type: 'image/png', size: 3 * 1024 * 1024 }, 2 * 1024 * 1024)).toBe('size');
  });
});

describe('libraryPath', () => {
  it('is account-scoped and takes the extension from the MIME type', () => {
    expect(libraryPath('abc', 'image/jpeg', 'u1')).toBe('account-abc/u1.jpg');
    expect(libraryPath('abc', 'image/png', 'u2')).toBe('account-abc/u2.png');
  });
});

describe('fitWithin', () => {
  it('leaves small images alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
  });
  it('scales the longest side down keeping the ratio', () => {
    expect(fitWithin(5120, 2560)).toEqual({ width: 2560, height: 1280, scaled: true });
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000, scaled: true });
  });
});

describe('small helpers', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
  it('picks the first image from a drop', () => {
    const a = { type: 'text/plain' } as File;
    const b = { type: 'image/png' } as File;
    expect(firstImageFile([a, b])).toBe(b);
    expect(firstImageFile([])).toBeNull();
  });
  it('checks https links', () => {
    expect(isHttpsUrl('https://x.test/a.png')).toBe(true);
    expect(isHttpsUrl('http://x.test/a.png')).toBe(false);
    expect(isHttpsUrl('nope')).toBe(false);
  });
});
