import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

const tablesWithoutDomainData = new Set([
  "profiles",
  // Membership rows (116): who belongs to the account, not domain data. They mirror profiles
  // and cascade with the account.
  "account_members",
  "account_invitations",
  "member_presence",
  "pending_message_statuses",
  // Auto-created billing row (free plan) - no user-entered data to protect.
  "account_subscriptions",
  // Financial history: guarded by ON DELETE RESTRICT (063), so account
  // deletion fails rather than silently dropping payment records.
  "subscription_payments",
  // Short-lived OTP codes (hashed, 7-day purge); an empty personal account being
  // discarded can hold none that matter, and they cascade with the account.
  "otp_verifications",
  // Encrypted copy of an api_keys row's secret: it only exists alongside that key,
  // and api_keys is already checked above, so an account with data here has data there.
  "api_key_secrets",
  // Delivery log rows only exist for a webhook_endpoints row (ON DELETE CASCADE),
  // and webhook_endpoints is already checked, so data here implies data there.
  "webhook_deliveries",
  // Image library: an empty personal account being discarded holds at most a
  // just-uploaded picture; the rows cascade with the account.
  "media_assets",
  // Admin console's daily MRR snapshot (admin schema, 088): derived numbers, no
  // user-entered data, and the rows cascade with the account.
  "metrics_snapshots",
  // Agent <-> knowledge links (097) only exist between an ai_agents row and an
  // ai_knowledge_sources row, both checked, so data here implies data there.
  "ai_agent_knowledge",
  // Admin console's per-business AI switch (admin schema, 096): set by platform
  // admins, not user-entered data, and the row cascades with the account.
  "ai_overrides",
  // Admin console's business suspension (admin schema, 107): set by platform admins on a
  // real business, not user-entered data, and the row cascades with the account.
  "account_suspensions",
  // Admin console announcement audiences (admin schema, 108): a frozen list of which businesses see a
  // banner, written by platform admins; the rows cascade with the account.
  "announcement_targets",
  // Payment checkouts (111): created by the billing flow for a real business, reference the
  // account for its plan change, and cascade with the account.
  "checkout_sessions",
  // Browser/phone push registrations (105): per-device, re-created by one tap,
  // and they cascade with the account.
  "push_subscriptions",
]);

function accountScopedTables(): Set<string> {
  const tables = new Set<string>();
  const accountForeignKey = /\baccount_id\s+uuid\b[^,;]*references\s+(?:public\.)?accounts\s*\(\s*id\s*\)/i;
  const tableName = /(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table)\s+(?:\w+\.)?(\w+)/i;
  for (const { sql } of migrations) {
    for (const statement of sql.split(";")) {
      if (!accountForeignKey.test(statement)) continue;
      const match = statement.match(tableName);
      if (match) tables.add(match[1].toLowerCase());
    }
  }
  return tables;
}

function latestFunctionBody(functionName: string): string {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`${functionName} is not defined in any migration`);
  const start = latest.sql.search(header);
  const bodyStart = latest.sql.indexOf("$$", start);
  const bodyEnd = latest.sql.indexOf("$$", bodyStart + 2);
  return latest.sql.slice(bodyStart + 2, bodyEnd);
}

describe("redeem_invitation migration", () => {
  const body = latestFunctionBody("redeem_invitation");

  it("finds the account-scoped tables it is meant to guard", () => {
    const tables = accountScopedTables();
    expect(tables).toContain("contacts");
    expect(tables).toContain("api_keys");
    expect(tables).toContain("quick_replies");
  });

  it("checks every account-scoped table for data before deleting the old account", () => {
    const missing = [...accountScopedTables()]
      .filter((table) => !tablesWithoutDomainData.has(table))
      .filter((table) => !new RegExp(`from\\s+${table}\\s+where\\s+account_id\\s*=\\s*v_old_account_id`, "i").test(body));
    expect(missing).toEqual([]);
  });

  it("refuses when the old account has other members", () => {
    expect(body).toMatch(/from\s+profiles\s+where\s+account_id\s*=\s*v_old_account_id\s+and\s+user_id\s*<>\s*v_caller_id/i);
  });
});

describe("member RPC migrations", () => {
  it.each(["set_member_role", "remove_account_member", "transfer_account_ownership"])(
    "%s locks the caller and target profiles in user_id order",
    (functionName) => {
      expect(latestFunctionBody(functionName)).toMatch(
        /from\s+profiles\s+where\s+user_id\s+in\s*\(\s*auth\.uid\(\),\s*p_\w+\s*\)\s+order\s+by\s+user_id\s+for\s+update/i,
      );
    },
  );
});
