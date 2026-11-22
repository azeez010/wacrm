import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { collectTagUsage } from '@/lib/contacts/tag-usage'

// What depends on a tag: saved segments, active automations and flows, and
// open broadcasts. Read-only, account-scoped. Used by the remove-tag
// confirmation so people see the consequences first.

type One<T> = T | T[] | null
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id: tagId } = await params
    if (!/^[0-9a-f-]{36}$/i.test(tagId)) {
      return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 })
    }
    const db = supabaseAdmin()
    const acc = ctx.accountId

    const [segments, automations, steps, nodes, broadcasts, contactCount] = await Promise.all([
      db.from('segments').select('id, name, filter').eq('account_id', acc),
      db
        .from('automations')
        .select('id, name, trigger_type, trigger_config')
        .eq('account_id', acc)
        .eq('is_active', true)
        .eq('trigger_type', 'tag_added'),
      db
        .from('automation_steps')
        .select('automation_id, step_type, step_config, automation:automations!inner(id, name, is_active, account_id)')
        .in('step_type', ['add_tag', 'remove_tag', 'condition'])
        .eq('automation.account_id', acc)
        .eq('automation.is_active', true)
        .limit(5000),
      db
        .from('flow_nodes')
        .select('node_type, config, flow:flows!inner(id, name, status, account_id)')
        .in('node_type', ['set_tag', 'condition'])
        .eq('flow.account_id', acc)
        .eq('flow.status', 'active')
        .limit(5000),
      db
        .from('broadcasts')
        .select('id, name, status, audience_filter')
        .eq('account_id', acc)
        .in('status', ['draft', 'scheduled', 'sending']),
      // contact_tags is scoped through its tag, so confirm the tag belongs to this account first
      db
        .from('contact_tags')
        .select('id, tags!inner(account_id)', { count: 'exact', head: true })
        .eq('tag_id', tagId)
        .eq('tags.account_id', acc),
    ])
    for (const r of [segments, automations, steps, nodes, broadcasts, contactCount]) {
      if (r.error) {
        console.error('[tags/usage]', r.error.message)
        return NextResponse.json({ error: 'Could not load tag usage' }, { status: 500 })
      }
    }

    const usage = collectTagUsage(
      {
        segments: (segments.data ?? []) as never,
        automations: (automations.data ?? []) as never,
        steps: ((steps.data ?? []) as unknown as { automation: One<unknown> }[]).map((s) => ({
          ...s,
          automation: one(s.automation),
        })) as never,
        nodes: ((nodes.data ?? []) as unknown as { flow: One<unknown> }[]).map((n) => ({
          ...n,
          flow: one(n.flow),
        })) as never,
        broadcasts: (broadcasts.data ?? []) as never,
      },
      tagId,
    )
    return NextResponse.json({ usage: { ...usage, contactCount: contactCount.count ?? 0 } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
