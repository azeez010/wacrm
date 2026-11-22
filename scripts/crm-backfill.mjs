#!/usr/bin/env node
// Queue every user for a CRM sync, then drain the queue.
//
//   CRM_BASE_URL=https://ogadesk.com AUTOMATION_CRON_SECRET=... npm run crm:backfill
//
// Run it once after turning the CRM provider on (existing users were never synced),
// and again any time you want to refresh usage attributes for everyone.

const base = (process.env.CRM_BASE_URL || '').replace(/\/+$/, '')
const secret = process.env.AUTOMATION_CRON_SECRET
if (!base || !secret) {
  console.error('Set CRM_BASE_URL (e.g. https://ogadesk.com) and AUTOMATION_CRON_SECRET.')
  process.exit(1)
}

async function call(path, method) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'x-cron-secret': secret } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(body)}`)
  return body
}

const { queued } = await call('/api/crm/resync', 'POST')
console.log(`Queued ${queued} users.`)

let totals = { claimed: 0, sent: 0, retried: 0, dead: 0 }
for (let round = 0; round < 500; round++) {
  const r = await call('/api/crm/flush', 'POST')
  for (const k of Object.keys(totals)) totals[k] += r[k] ?? 0
  process.stdout.write(`\rsent ${totals.sent}, retrying ${totals.retried}, dead ${totals.dead}   `)
  if ((r.claimed ?? 0) === 0) break
}
console.log('\nDone.', totals)
