'use client';

import { useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { FieldDef } from '@/lib/custom-fields/types';

export interface TableColumnOption {
  /** The contact's reference field that points at the table. */
  refFieldId: string;
  refFieldName: string;
  tableName: string;
  column: FieldDef;
}

export interface FormEditorData {
  customFields: FieldDef[];
  tableColumns: TableColumnOption[];
  tags: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  templates: { name: string; language: string }[];
  /** The account's WhatsApp numbers (a form can send from a specific one). */
  connections: { id: string; name: string }[];
  loading: boolean;
  /** Re-read the account's fields, tables and tags (e.g. after creating a custom field). */
  reload: () => void;
}

type LoadedData = Omit<FormEditorData, 'reload'>;

const EMPTY: LoadedData = { customFields: [], tableColumns: [], tags: [], agents: [], pipelines: [], templates: [], connections: [], loading: true };

/** Everything the form editor needs to offer: the account's fields, tables, tags, agents, pipelines. */
export function useFormEditorData(accountId: string | null): FormEditorData {
  const [data, setData] = useState<LoadedData>(EMPTY);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void (async () => {
      const db = createClient();
      const [fields, tags, agents, pipelines, templates, connections] = await Promise.all([
        db
          .from('custom_fields')
          .select('id, key, field_name, field_type, field_options, required, table_id')
          .eq('account_id', accountId)
          .is('archived_at', null)
          .order('sort_order'),
        db.from('tags').select('id, name').eq('account_id', accountId).order('name'),
        db.from('profiles').select('user_id, full_name, account_role').eq('account_id', accountId),
        db.from('pipelines').select('id, name, pipeline_stages(id, name, position)').eq('account_id', accountId),
        db.from('message_templates').select('name, language, status').eq('account_id', accountId).eq('status', 'APPROVED'),
        db.from('whatsapp_config').select('id, label, display_phone_number, verified_name').eq('account_id', accountId),
      ]);
      const all = (fields.data ?? []) as (FieldDef & { table_id: string | null })[];
      const contactFields = all.filter((f) => !f.table_id && f.field_type !== 'media');
      const refs = contactFields.filter((f) => f.field_type === 'reference');
      const tableKeys = [...new Set(refs.map((r) => (r.field_options as { table_key?: string } | null)?.table_key).filter((k): k is string => !!k))];
      let tableColumns: TableColumnOption[] = [];
      if (tableKeys.length > 0) {
        const { data: tables } = await db.from('custom_tables').select('id, key, name').eq('account_id', accountId).is('archived_at', null).in('key', tableKeys);
        const tbl = (tables ?? []) as { id: string; key: string; name: string }[];
        const cols = all.filter((f) => f.table_id && tbl.some((t) => t.id === f.table_id) && f.field_type !== 'media' && f.field_type !== 'reference');
        tableColumns = refs.flatMap((r) => {
          const key = (r.field_options as { table_key?: string } | null)?.table_key;
          const t = tbl.find((x) => x.key === key);
          if (!t) return [];
          return cols.filter((c) => c.table_id === t.id).map((column) => ({ refFieldId: r.id, refFieldName: r.field_name, tableName: t.name, column }));
        });
      }
      if (cancelled) return;
      setData({
        customFields: contactFields.filter((f) => f.field_type !== 'reference'),
        tableColumns,
        tags: (tags.data ?? []) as { id: string; name: string }[],
        agents: ((agents.data ?? []) as { user_id: string; full_name: string | null; account_role: string }[])
          .filter((p) => p.account_role !== 'viewer')
          .map((p) => ({ id: p.user_id, name: p.full_name?.trim() || p.user_id.slice(0, 6) })),
        pipelines: ((pipelines.data ?? []) as { id: string; name: string; pipeline_stages?: { id: string; name: string; position: number }[] }[]).map((p) => ({
          id: p.id,
          name: p.name,
          stages: [...(p.pipeline_stages ?? [])].sort((a, b) => a.position - b.position),
        })),
        templates: ((templates.data ?? []) as { name: string; language: string }[]).map((x) => ({ name: x.name, language: x.language })),
        connections: ((connections.data ?? []) as { id: string; label: string | null; display_phone_number: string | null; verified_name: string | null }[]).map((c) => ({
          id: c.id,
          name: [c.label || c.verified_name, c.display_phone_number].filter(Boolean).join(' · ') || c.id.slice(0, 8),
        })),
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, version]);

  return useMemo(() => ({ ...data, reload: () => setVersion((v) => v + 1) }), [data]);
}
