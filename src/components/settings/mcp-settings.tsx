'use client';

// ============================================================
// McpSettings - Settings → Claude (MCP)
//
// Connect Claude (Code / Desktop) or any MCP client to this CRM over
// the hosted endpoint at /api/mcp. Auth is a normal API key; its
// scopes decide which tools the assistant gets. This panel mints a
// key with a safe preset and shows ready-to-paste client config.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, Copy, Loader2, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RequireRole } from '@/components/auth/require-role';
import { cn } from '@/lib/utils';
import type { ApiScope } from '@/lib/api-keys/scopes';
import { SettingsPanelHead } from './settings-panel-head';

const READ_SCOPES: ApiScope[] = [
  'contacts:read',
  'conversations:read',
  'messages:read',
  'templates:read',
  'pipelines:read',
  'automations:read',
  'flows:read',
];

const BUILDER_SCOPES: ApiScope[] = [
  ...READ_SCOPES,
  'pipelines:write',
  'automations:write',
  'flows:write',
  'templates:write',
];

const PRESETS: {
  id: string;
  label: string;
  hint: string;
  scopes: ApiScope[];
}[] = [
  {
    id: 'read',
    label: 'Read-only',
    hint: 'Look up contacts, conversations, messages, pipelines, automations and flows. Cannot change anything. Recommended for getting started.',
    scopes: READ_SCOPES,
  },
  {
    id: 'builder',
    label: 'Campaign builder',
    hint: 'Everything in Read-only, plus build pipelines, automations, chatbot flows and message templates. New automations and flows are saved as drafts. It cannot message customers directly.',
    scopes: BUILDER_SCOPES,
  },
  {
    id: 'full',
    label: 'Full access',
    hint: 'Campaign builder, plus edit contacts and deals, send WhatsApp messages and launch broadcasts (mass sends).',
    scopes: [...BUILDER_SCOPES, 'contacts:write', 'messages:send', 'broadcasts:send'],
  },
];

const CAPABILITIES: { scope: string; title: string; examples: string }[] = [
  {
    scope: 'Read',
    title: 'Ask questions about your CRM',
    examples:
      '“How many conversations are still open?” · “Summarise my last chat with +234…” · “Which contacts are tagged VIP?”',
  },
  {
    scope: 'Build',
    title: 'Set up whole campaigns for you',
    examples:
      '“Build a 3-day follow-up sequence for people tagged Webinar” · “Create a support menu flow with Sales / Billing / Human options” · “Make a Leads pipeline with 5 stages”',
  },
  {
    scope: 'Write',
    title: 'Keep contacts and deals up to date',
    examples: '“Add this lead with the tag Webinar” · “Move Ada’s deal to Negotiation” · “Mark it won”',
  },
  {
    scope: 'Send',
    title: 'Message customers',
    examples: '“Send the order_update template to +234…” · “Reply to Tunde that his order shipped”',
  },
  {
    scope: 'Templates',
    title: 'Create message templates',
    examples:
      '“Create a Utility template for order shipping updates in English”, submitted to Meta for approval (needs a connected WhatsApp number)',
  },
  {
    scope: 'Broadcast',
    title: 'Run campaigns',
    examples: '“Send the promo template to these 40 numbers” (always asks for confirmation first)',
  },
];

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy, select the text manually.');
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-xs font-medium">{label}</span>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-muted text-foreground overflow-x-auto rounded-lg p-3 text-xs leading-relaxed">
        {value}
      </pre>
    </div>
  );
}

export function McpSettings() {
  const [presetId, setPresetId] = useState('read');
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${origin}/api/mcp`;
  const keyText = key ?? 'YOUR_API_KEY';

  async function createKey() {
    const preset = PRESETS.find((p) => p.id === presetId)!;
    setCreating(true);
    try {
      const res = await fetch('/api/account/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Claude MCP (${preset.label})`, scopes: preset.scopes }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Could not create the key.');
        return;
      }
      setKey(payload.plaintext as string);
    } catch {
      toast.error('Network error, try again.');
    } finally {
      setCreating(false);
    }
  }

  const claudeCode = `claude mcp add --transport http wacrm ${url} \\\n  --header "Authorization: Bearer ${keyText}"`;
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        wacrm: {
          command: 'npx',
          args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${keyText}`],
        },
      },
    },
    null,
    2,
  );
  const cursorJson = JSON.stringify(
    { mcpServers: { wacrm: { url, headers: { Authorization: `Bearer ${keyText}` } } } },
    null,
    2,
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanelHead
        title="Claude (MCP)"
        description="Let Claude, or any MCP client, look things up in this CRM and act on it, using a scoped API key."
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <p className="text-foreground text-sm font-medium">1 · Choose what Claude may do</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              The key&apos;s permissions decide which tools Claude can even see.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                disabled={!!key}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors disabled:opacity-60',
                  presetId === p.id ? 'border-primary ring-primary ring-1' : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {p.id === 'read' && <ShieldCheck className="text-primary size-4" />}
                  {p.label}
                </span>
                <span className="text-muted-foreground mt-1 block text-xs">{p.hint}</span>
              </button>
            ))}
          </div>

          <RequireRole
            min="admin"
            fallback={
              <p className="text-muted-foreground text-xs">
                Ask an account admin to create an API key for you, then paste it below.
              </p>
            }
          >
            {key ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This key is shown once. Copy the commands below now, it can&apos;t be displayed
                  again (you can revoke it any time under{' '}
                  <Link href="/settings?tab=api" className="underline">
                    API keys
                  </Link>
                  ).
                </p>
              </div>
            ) : (
              <Button onClick={createKey} disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                Create key &amp; show setup
              </Button>
            )}
          </RequireRole>
          {!key && (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-xs">
                Already have a key? Paste it to fill the commands below:
              </p>
              <Input
                placeholder="wacrm_live_…"
                onChange={(e) => setKey(e.target.value.trim() || null)}
                className="max-w-md font-mono text-xs"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <p className="text-foreground text-sm font-medium">2 · Connect your client</p>
          <CopyBlock label="Server URL" value={url} />
          <CopyBlock label="Claude Code (terminal)" value={claudeCode} />
          <CopyBlock
            label="Claude Desktop, add to claude_desktop_config.json (needs Node.js)"
            value={desktopJson}
          />
          <CopyBlock label="Cursor / Windsurf / other clients that accept a URL" value={cursorJson} />
          <p className="text-muted-foreground text-xs">
            Claude.ai&apos;s browser “custom connectors” require OAuth sign-in, which isn&apos;t
            supported yet, use Claude Code or Desktop for now. Treat the key like a password.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-foreground text-sm font-medium">What you can do once connected</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <li key={c.scope} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{c.title}</p>
                <p className="text-muted-foreground mt-1 text-xs">{c.examples}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
