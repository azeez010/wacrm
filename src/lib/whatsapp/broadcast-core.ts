// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  - validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() - send each recipient's template via Meta
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  parseInternationalPhone,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { resolveTemplateRow } from '@/lib/whatsapp/template-body';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { assertAccountNotSuspended } from '@/lib/auth/suspension';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) - counted as failed. */
  rejected: number;
}

export interface CreatedBroadcastPlan extends BroadcastPlan {
  duplicates: number;
  /** Recipients dropped because their contact is blocked. */
  blockedSkipped?: number;
  /** Recipients dropped because Meta reported their number undeliverable (account switch). */
  unreachableSkipped?: number;
}

const MAX_RECIPIENTS = 1000;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure - nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<CreatedBroadcastPlan> {
  const { name, templateName, recipients } = params;

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const resolvedTemplate = await resolveTemplateRow(
    db,
    accountId,
    templateName,
    params.templateLanguage
  );
  if (resolvedTemplate.malformed) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally, run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = resolvedTemplate.row;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  // `to` is raw integrator input, so the leading `+` is required - a
  // national-format number would otherwise be delivered to whichever
  // country its leading digits spell (issue #586).
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const to = typeof r.to === 'string' ? r.to : '';
    const sanitized = parseInternationalPhone(to);
    if (!sanitized) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: to,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate - and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  // Suppression list: blocked contacts never receive a broadcast. They
  // are dropped here (not counted as recipients) and reported back.
  const blockedIds = await fetchBlockedContactIds(
    db,
    accountId,
    deduped.map((r) => r.contactId)
  );
  const blockedSkipped = deduped.filter((r) => blockedIds.has(r.contactId)).length;
  if (blockedSkipped > 0) {
    for (let i = deduped.length - 1; i >= 0; i--) {
      if (blockedIds.has(deduped[i].contactId)) deduped.splice(i, 1);
    }
    if (deduped.length === 0) {
      throw new BroadcastError(
        'contact_blocked',
        'Every recipient is blocked, so nothing was sent.',
        400
      );
    }
  }

  // Optional account switch: numbers Meta reported undeliverable (131026) are left out too.
  let unreachableSkipped = 0;
  const { data: acct } = await db.from('accounts').select('broadcast_skip_unreachable').eq('id', accountId).maybeSingle();
  if (acct?.broadcast_skip_unreachable === true && deduped.length > 0) {
    const ghosts = await fetchUnreachableContactIds(db, accountId, deduped.map((r) => r.contactId));
    for (let i = deduped.length - 1; i >= 0; i--) {
      if (ghosts.has(deduped[i].contactId)) {
        deduped.splice(i, 1);
        unreachableSkipped++;
      }
    }
    if (deduped.length === 0) {
      throw new BroadcastError('bad_request', 'Every recipient is unreachable on WhatsApp, so nothing was sent.', 400);
    }
  }

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid international phone number (leading + and country code, e.g. +14155550123)',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows - we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  // Insert the parent broadcast and its recipient rows in ONE transaction
  // (migration 037's create_broadcast_with_recipients). Previously these
  // were two separate inserts: if the recipient insert failed, the parent
  // was already persisted with status 'sending' and no recipients, leaving
  // an orphaned campaign that looked like it was sending but had no
  // delivery plan (issue #370). The function body is atomic, so a recipient
  // failure now rolls the parent back and nothing orphaned survives.
  const { data: createdRows, error: createErr } = await db.rpc(
    'create_broadcast_with_recipients',
    {
      p_account_id: accountId,
      p_user_id: auditUserId,
      p_name: name || `API broadcast (${templateName})`,
      p_template_name: templateName,
      p_template_language: resolvedTemplate.language,
      p_total_recipients: deduped.length,
      p_contact_ids: deduped.map((r) => r.contactId),
      // Frozen per-recipient params (migration 038) - without them a
      // resume of this broadcast has no way to reconstruct {{1}}.
      p_template_params: deduped.map((r) => r.params),
    }
  );
  if (createErr || !createdRows || createdRows.length === 0) {
    console.error('[broadcast-core] create broadcast error:', createErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const broadcastId = createdRows[0].broadcast_id as string;

  // Pair each inserted recipient row back to its phone/params by
  // contact_id - unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = createdRows.map(
    (row: { recipient_id: string; contact_id: string }) => {
      const r = byContact.get(row.contact_id)!;
      return { recipientRowId: row.recipient_id, phone: r.phone, params: r.params };
    }
  );

  return {
    broadcastId,
    templateName,
    templateLanguage: resolvedTemplate.language,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected,
    duplicates: resolved.length - deduped.length - blockedSkipped - unreachableSkipped,
    blockedSkipped,
    unreachableSkipped,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient - one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later Meta delivery/read
 * webhooks keep advancing them. We therefore never write those columns
 * here - only the terminal `status` - otherwise a manual value would
 * race and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  // A suspended business sends nothing, including broadcasts that were already scheduled.
  const { data: owner } = await db.from('broadcasts').select('account_id').eq('id', plan.broadcastId).maybeSingle();
  if (owner?.account_id) await assertAccountNotSuspended(db, owner.account_id as string);
  // Re-check right before sending: a contact may have been blocked since
  // the broadcast was created (or this is a resume of an older one).
  const blockedRows = await fetchBlockedRecipientRowIds(
    db,
    plan.planned.map((r) => r.recipientRowId)
  );

  for (const recipient of plan.planned) {
    if (blockedRows.has(recipient.recipientRowId)) {
      await db
        .from('broadcast_recipients')
        .update({ status: 'failed', error_message: blockedRows.get(recipient.recipientRowId) ?? 'Contact is blocked' })
        .eq('id', recipient.recipientRowId);
      continue;
    }
    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: plan.phoneNumberId,
          accessToken: plan.accessToken,
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          params: recipient.params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        lastError = message;
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(message)) break;
      }
    }

    if (sentMessageId) {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  await finalizeBroadcastStatus(db, plan.broadcastId);
}

/**
 * Flip a broadcast out of `sending` once no recipient is left pending.
 *
 * Derived from the recipient rows rather than from a counter local to
 * one delivery pass: a resume (issue #472) delivers only the leftovers,
 * so "nothing sent *this* pass" must not mark a campaign failed when
 * 800 of its 1 000 recipients went out earlier. `failed` means every
 * single recipient failed; anything else that reached Meta is `sent`,
 * with the per-recipient failures visible in `failed_count`.
 *
 * Per-status counts stay trigger-owned (migrations 003/005) - only the
 * terminal `status` is written here.
 */
export async function finalizeBroadcastStatus(
  db: SupabaseClient,
  broadcastId: string
): Promise<void> {
  const countWhere = async (status: string): Promise<number> => {
    const { count } = await db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', status);
    return count ?? 0;
  };

  // Still work outstanding (a capped resume pass) - leave it 'sending'
  // so the UI keeps offering Resume.
  if ((await countWhere('pending')) > 0) return;

  const failed = await countWhere('failed');
  const { count: total } = await db
    .from('broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId);

  await db
    .from('broadcasts')
    .update({
      status: failed > 0 && failed === (total ?? 0) ? 'failed' : 'sent',
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);
}


/** Of `contactIds`, the ones currently blocked in this account. */
async function fetchBlockedContactIds(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      // blocked, or archived by a lower plan: both are left out of broadcasts
      .or('blocked_at.not.is.null,plan_archived_at.not.is.null')
      .in('id', contactIds.slice(i, i + 200));
    for (const row of data ?? []) out.add(row.id as string);
  }
  return out;
}

/** Of `contactIds`, the ones Meta reported undeliverable (wa_status 'unreachable'). */
async function fetchUnreachableContactIds(
  db: SupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('wa_status', 'unreachable')
      .in('id', contactIds.slice(i, i + 200));
    for (const row of data ?? []) out.add(row.id as string);
  }
  return out;
}

/** Of these broadcast_recipients rows, the ones whose contact is blocked or archived by the plan, with the reason. */
async function fetchBlockedRecipientRowIds(
  db: SupabaseClient,
  rowIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  type C = { blocked_at?: string | null; plan_archived_at?: string | null };
  for (let i = 0; i < rowIds.length; i += 200) {
    const { data } = await db
      .from('broadcast_recipients')
      .select('id, contact:contacts(blocked_at, plan_archived_at)')
      .in('id', rowIds.slice(i, i + 200));
    for (const row of (data ?? []) as { id: string; contact: C | C[] | null }[]) {
      const c = Array.isArray(row.contact) ? row.contact[0] : row.contact;
      if (c?.blocked_at) out.set(row.id, 'Contact is blocked');
      else if (c?.plan_archived_at) out.set(row.id, 'Contact was archived by your plan');
    }
  }
  return out;
}
