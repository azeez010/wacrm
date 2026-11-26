import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE_PREFERENCE, isModePreference, resolveMode } from './themes';

describe('mode preference', () => {
  it('defaults to following the system', () => {
    expect(DEFAULT_MODE_PREFERENCE).toBe('system');
  });
  it('accepts system, light and dark only', () => {
    expect(['system', 'light', 'dark'].every(isModePreference)).toBe(true);
    expect(isModePreference('auto')).toBe(false);
    expect(isModePreference(null)).toBe(false);
  });
  it('resolves system from the OS and leaves explicit choices alone', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});
