import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { QUICK_ACTIONS, registeredPaths, scoreMatch } from './command-registry';

const DASHBOARD_DIR = join(process.cwd(), 'src/app/(dashboard)');

/** Static dashboard routes, e.g. '/forms', '/broadcasts/new'. Dynamic ([id]) routes are skipped. */
function dashboardRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx') {
        const rel = relative(DASHBOARD_DIR, dir).split(sep).join('/');
        if (rel.includes('[')) continue;
        out.push('/' + rel);
      }
    }
  };
  walk(DASHBOARD_DIR);
  return out;
}

describe('command palette registry', () => {
  it('covers every static dashboard page (add new pages to src/lib/command-registry.ts)', () => {
    const registered = registeredPaths();
    const missing = dashboardRoutes().filter((r) => !registered.has(r));
    expect(
      missing,
      `Add these pages to EXTRA_PAGES / QUICK_ACTIONS in src/lib/command-registry.ts (or src/lib/nav.ts) so Cmd+K can find them: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has unique quick-action ids', () => {
    const ids = QUICK_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scoreMatch', () => {
  it('ranks prefix above substring above keyword, and rejects non-matches', () => {
    const prefix = scoreMatch('int', { label: 'Integrations' });
    const sub = scoreMatch('grat', { label: 'Integrations' });
    const kw = scoreMatch('token', { label: 'API & MCP', keywords: 'api keys token' });
    expect(prefix).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(kw);
    expect(scoreMatch('zzz', { label: 'Inbox' })).toBe(0);
  });

  it('matches a word inside the label and in-order letters', () => {
    expect(scoreMatch('mcp', { label: 'API & MCP' })).toBeGreaterThanOrEqual(80);
    expect(scoreMatch('tmpl', { label: 'Templates' })).toBeGreaterThan(0);
  });
});
