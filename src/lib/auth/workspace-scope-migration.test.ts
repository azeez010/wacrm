import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every table that belongs to a workspace (has an account_id) must be limited to the
// person's ACTIVE workspace by the database itself (migration 125's workspace_scope
// policy, applied with public.enforce_workspace_scope). Without it a person who belongs
// to two workspaces would see and could write the rows of both. A new tenant table must
// call enforce_workspace_scope in its migration, or be listed below with the reason.

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

const exempt = new Map<string, string>([
  ["account_members", "the workspace switcher lists every workspace a person belongs to"],
  ["profiles", "a profile is a person, not workspace data"],
  // Service-only tables: RLS on, no client policy, only the service role reads them.
  // (crm_outbox is service-only too; its account_id has no foreign key, so the scan never sees it.)
  ["api_key_secrets", "service-only"],
  ["automation_pending_executions", "service-only"],
  ["form_events", "service-only"],
  ["otp_verifications", "service-only"],
  ["pending_message_statuses", "service-only"],
  ["coupon_redemptions", "service-only (admin and billing functions only)"],
  ["trial_grants", "service-only (the trial rules; one trial per person)"],
  // Admin console schema (admin.*): not reachable by the signed-in app role.
  ["account_suspensions", "admin schema"],
  ["ai_overrides", "admin schema"],
  ["announcement_targets", "admin schema"],
  ["metrics_snapshots", "admin schema"],
]);

function accountScopedTables(): Set<string> {
  const tables = new Set<string>();
  const accountForeignKey = /\baccount_id\s+uuid\b[^,;]*references\s+(?:public\.)?accounts\s*\(\s*id\s*\)/i;
  const tableName = /(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?)\s+(?:\w+\.)?(\w+)/i;
  for (const { sql } of migrations) {
    for (const statement of sql.split(";")) {
      if (!accountForeignKey.test(statement)) continue;
      const match = statement.match(tableName);
      if (match) tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

function scopedTables(): Set<string> {
  const out = new Set<string>();
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(/enforce_workspace_scope\(\s*'(?:public\.)?(\w+)'\s*::\s*regclass\s*\)/gi)) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

describe("workspace scope", () => {
  const tenant = accountScopedTables();
  const scoped = scopedTables();

  it("finds the tenant tables it is meant to guard", () => {
    for (const t of ["contacts", "conversations", "pipelines", "broadcasts", "message_templates"]) {
      expect(tenant, t).toContain(t);
    }
  });

  it("scopes every workspace table to the active workspace (or says why not)", () => {
    const missing = [...tenant].filter((t) => !scoped.has(t) && !exempt.has(t)).sort();
    expect(missing).toEqual([]);
  });

  it("does not scope tables it should leave open", () => {
    for (const t of ["account_members", "profiles", "accounts"]) {
      expect(scoped.has(t), t).toBe(false);
    }
  });

  it("only exempts tables that still exist as workspace tables", () => {
    const stale = [...exempt.keys()].filter((t) => !tenant.has(t));
    expect(stale).toEqual([]);
  });

  it("creates the policy as RESTRICTIVE for signed-in users on the active workspace", () => {
    const sql = migrations.find((m) => m.name.startsWith("125_"))!.sql;
    expect(sql).toMatch(/AS RESTRICTIVE FOR ALL TO authenticated/);
    expect(sql).toMatch(/account_id = \(SELECT public\.current_account_id\(\)\)/);
    expect(sql).toMatch(/WITH CHECK/);
  });
});
