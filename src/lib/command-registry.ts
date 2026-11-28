// ============================================================
// Command palette registry (Cmd/Ctrl+K).
//
// Everything the palette can jump to or start. Pages come from
// `lib/nav.ts` (the same array the sidebar renders) and settings tabs
// from `settings-sections.ts`, so those appear automatically. Quick
// actions and the few pages outside the sidebar are listed here.
//
// ADDING A PAGE OR A CREATE-DIALOG? Add it here (see EXTRA_PAGES /
// QUICK_ACTIONS). `command-registry.test.ts` fails when a dashboard
// page is neither reachable from here nor on its ignore list.
// ============================================================

import {
  Bell,
  Blocks,
  ClipboardList,
  GitBranch,
  Radio,
  Upload,
  UserPlus,
  UsersRound,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { CanAction } from '@/hooks/use-can';
import { bottomNavItems, navItems } from '@/lib/nav';
import type { SettingsSection } from '@/components/settings/settings-sections';

export interface QuickAction {
  id: string;
  /** Label key under the `CommandPalette.actions` i18n namespace. */
  labelKey: string;
  icon: LucideIcon;
  /** Page that opens the dialog (via a `?param=1` deep link). */
  href: string;
  /** Hidden from roles that lack this capability. */
  can?: CanAction;
  /** Extra search words (English), matched in any locale. */
  keywords: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'new-contact', labelKey: 'newContact', icon: UserPlus, href: '/contacts?new=1', can: 'send-messages', keywords: 'add contact customer lead person' },
  { id: 'new-deal', labelKey: 'newDeal', icon: GitBranch, href: '/pipelines?new=1', can: 'send-messages', keywords: 'add deal opportunity sale' },
  { id: 'import-contacts', labelKey: 'importContacts', icon: Upload, href: '/contacts?import=1', can: 'send-messages', keywords: 'upload csv spreadsheet' },
  { id: 'create-form', labelKey: 'createForm', icon: ClipboardList, href: '/forms?new=1', can: 'manage-forms', keywords: 'new form lead capture support button' },
  { id: 'create-broadcast', labelKey: 'createBroadcast', icon: Radio, href: '/broadcasts/new', can: 'send-messages', keywords: 'new broadcast campaign bulk message send' },
  { id: 'create-automation', labelKey: 'createAutomation', icon: Zap, href: '/automations/new', can: 'send-messages', keywords: 'new automation rule trigger workflow' },
  { id: 'create-flow', labelKey: 'createFlow', icon: Workflow, href: '/flows?new=1', can: 'send-messages', keywords: 'new flow chatbot bot' },
  { id: 'new-pipeline', labelKey: 'newPipeline', icon: GitBranch, href: '/pipelines?newPipeline=1', can: 'edit-settings', keywords: 'create pipeline stages board' },
  { id: 'invite-team', labelKey: 'inviteTeam', icon: UsersRound, href: '/settings?tab=members&invite=1', can: 'manage-members', keywords: 'invite teammate member agent add user' },
];

export interface ExtraPage {
  href: string;
  /** Label key under the `CommandPalette.pages` i18n namespace. */
  labelKey: string;
  icon: LucideIcon;
  keywords: string;
}

/** Dashboard pages that are not in the sidebar. */
export const EXTRA_PAGES: ExtraPage[] = [
  { href: '/notifications', labelKey: 'notifications', icon: Bell, keywords: 'alerts activity bell' },
  { href: '/integrations', labelKey: 'integrations', icon: Blocks, keywords: 'integrations ai tools mcp http action paystack payment link google calendar connect' },
];

/** Search aliases for settings tabs (English; matched in any locale). */
export const SETTINGS_KEYWORDS: Partial<Record<SettingsSection, string>> = {
  profile: 'account name photo avatar email',
  billing: 'plan subscription payment invoice upgrade pricing',
  security: 'password sessions sign in login',
  appearance: 'theme dark light colour color accent',
  language: 'locale translation',
  timezone: 'time zone clock',
  whatsapp: 'number connect business api cloud meta phone',
  templates: 'message templates whatsapp approval',
  'quick-replies': 'canned responses shortcuts snippets',
  inbox: 'conversations assignment business hours',
  fields: 'tags custom fields labels',
  tables: 'custom tables data records',
  deals: 'currency pipeline money',
  members: 'team invite users roles agents',
  api: 'api keys mcp integrations developer token claude chatgpt cursor',
  webhooks: 'webhook events callback integrations developer notify url',
};

/** Every in-app path (no query) the palette can open. Used by the coverage test. */
export function registeredPaths(): Set<string> {
  const out = new Set<string>();
  const add = (href: string) => out.add(href.split('?')[0]);
  [...navItems, ...bottomNavItems].forEach((i) => add(i.href));
  EXTRA_PAGES.forEach((p) => add(p.href));
  QUICK_ACTIONS.forEach((a) => add(a.href));
  add('/settings');
  return out;
}

export interface Scorable {
  label: string;
  breadcrumb?: string;
  keywords?: string;
}

/**
 * Rank how well `query` matches an entry (0 = no match). Prefix beats
 * word-prefix beats substring beats keyword beats loose in-order letters.
 */
export function scoreMatch(query: string, entry: Scorable): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = entry.label.toLowerCase();
  if (label === q) return 120;
  if (label.startsWith(q)) return 100;
  if (label.split(/[\s/&-]+/).some((w) => w.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  const rest = `${entry.keywords ?? ''} ${entry.breadcrumb ?? ''}`.toLowerCase();
  if (rest.split(/\s+/).some((w) => w.startsWith(q))) return 45;
  if (rest.includes(q)) return 35;
  // Every word of a multi-word query must hit somewhere.
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((w) => `${label} ${rest}`.includes(w))) return 30;
  // Loose "letters in order" (e.g. "tmpl" -> "Templates").
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 15 : 0;
}
