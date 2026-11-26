import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

function latestFunctionBody(functionName: string): string {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`${functionName} is not defined in any migration`);
  const start = latest.sql.search(header);
  const tag = /\$[a-z_]*\$/i.exec(latest.sql.slice(start));
  if (!tag) throw new Error(`${functionName}: no dollar-quoted body`);
  const bodyStart = start + tag.index + tag[0].length;
  return latest.sql.slice(bodyStart, latest.sql.indexOf(tag[0], bodyStart));
}

// Since multi-workspace (migration 121) joining a workspace adds a membership and
// keeps every workspace the person already has. It must never delete an account,
// which is what the old version did to the invitee's personal workspace.
describe("redeem_invitation migration", () => {
  const body = latestFunctionBody("redeem_invitation");

  it("never deletes an account", () => {
    expect(body).not.toMatch(/delete\s+from\s+(?:public\.)?accounts\b/i);
  });

  it("adds a membership for the invited role", () => {
    expect(body).toMatch(/insert\s+into\s+account_members\s*\(\s*user_id,\s*account_id,\s*account_role\s*\)/i);
    expect(body).toMatch(/v_inv\.role/);
  });

  it("refuses an expired, used or duplicate invitation", () => {
    expect(body).toMatch(/v_inv\.accepted_at\s+is\s+not\s+null/i);
    expect(body).toMatch(/v_inv\.expires_at\s*<=\s*now\(\)/i);
    expect(body).toMatch(/from\s+account_members\s+where\s+user_id\s*=\s*v_caller_id\s+and\s+account_id\s*=\s*v_inv\.account_id/i);
  });

  it("locks the invitation row", () => {
    expect(body).toMatch(/from\s+account_invitations\s+where\s+token_hash\s*=\s*p_token_hash\s+for\s+update/i);
  });
});

describe("member RPC migrations", () => {
  it.each(["set_member_role", "remove_account_member", "transfer_account_ownership"])(
    "%s locks the caller and target memberships in user_id order",
    (functionName) => {
      expect(latestFunctionBody(functionName)).toMatch(
        /from\s+account_members\s+where\s+account_id\s*=\s*v_account\s+and\s+user_id\s+in\s*\(\s*auth\.uid\(\),\s*p_\w+\s*\)\s+order\s+by\s+user_id\s+for\s+update/i,
      );
    },
  );
});
