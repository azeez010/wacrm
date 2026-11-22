/**
 * MCP tools for custom contact fields, custom tables (and their rows) and
 * segments. Registered per request from the calling key's scopes.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ApiClient } from './dispatch'
import { DESTRUCTIVE, READ, WRITE, errorResult, has, limit, run } from './helpers'
import { CUSTOM_DATA_REFERENCE } from './reference'

const looseObj = z.record(z.string(), z.unknown())

const fieldType = z.enum(['text', 'number', 'bool', 'date', 'enum', 'multi_enum', 'reference', 'media'])

const fieldOptions = z
  .object({
    options: z.array(z.string()).optional().describe('enum / multi_enum: the allowed choices.'),
    format: z.enum(['plain', 'currency', 'percent']).optional().describe('number display format.'),
    currency: z.string().optional().describe('ISO code for the currency format, e.g. NGN.'),
    min: z.number().optional(),
    max: z.number().optional(),
    include_time: z.boolean().optional().describe('date: also store a time of day.'),
    table_key: z.string().optional().describe('reference: key of the custom table the value points into.'),
    accept: z.enum(['any', 'image', 'document', 'video', 'audio']).optional().describe('media: which kind of file is allowed.'),
  })
  .describe('Per-type options. See get_custom_data_reference.')

const filterRule = z.object({
  field: z.string().describe('name | phone | email | company | created_at | tags | cf:<custom field id>'),
  operator: z.string().describe('Depends on the field type, see get_custom_data_reference.'),
  value: z.unknown().optional(),
})

const filterSchema = z
  .object({
    version: z.literal(1).optional(),
    op: z.enum(['and', 'or']).optional(),
    rules: z.array(z.union([filterRule, looseObj])),
  })
  .describe('FilterGroup. Rules on deleted fields are ignored, unfinished rules are not allowed.')

function needConfirm(what: string) {
  return errorResult(
    `Refusing: confirm must be true. This permanently deletes ${what}. Ask the user, then call again with confirm=true.`,
  )
}

const confirm = z.boolean().describe('Must be true. Confirm with the user first; this cannot be undone.')

export function registerCustomTools(server: McpServer, api: ApiClient, scopes: string[]) {
  const anyRead = ['fields:read', 'tables:read', 'segments:read', 'fields:write', 'tables:write', 'segments:write']
  if (anyRead.some((s) => has(scopes, s))) {
    server.registerTool(
      'get_custom_data_reference',
      {
        title: 'Custom fields, tables and segments reference',
        description:
          'Field types, per-type options, the filter format and operators for each field type, and the value formats. Read before creating fields or segments.',
        inputSchema: {},
        annotations: { ...READ, title: 'Custom data reference' },
      },
      run(async () => ({ content: [{ type: 'text', text: CUSTOM_DATA_REFERENCE }] })),
    )
  }

  // ------------------------------------------------------------ fields
  if (has(scopes, 'fields:read')) {
    server.registerTool(
      'list_custom_fields',
      {
        title: 'List custom fields',
        description:
          'List custom contact fields (id, key, name, type, options, show_in_table, order). Use the key in contact custom_fields and the id in segment rules (cf:<id>).',
        inputSchema: { include_archived: z.boolean().optional() },
        annotations: { ...READ, title: 'List custom fields' },
      },
      run(async (a: { include_archived?: boolean }) =>
        api.listCustomFields({ include_archived: a.include_archived ? 'true' : undefined }),
      ),
    )
  }
  if (has(scopes, 'fields:write')) {
    server.registerTool(
      'create_custom_field',
      {
        title: 'Create custom field',
        description:
          'Create a typed custom contact field (e.g. Plan = enum, Amount = number, Started date = date, Auto-renew = bool). Subject to the plan limit.',
        inputSchema: {
          name: z.string().describe('Display name, e.g. "Plan".'),
          type: fieldType,
          options: fieldOptions.optional(),
          show_in_table: z.boolean().optional().describe('Show as a column in the Contacts table by default.'),
          description: z.string().optional(),
          required: z.boolean().optional(),
        },
        annotations: { ...WRITE, title: 'Create custom field' },
      },
      run(async (a) => api.createCustomField({ ...a, options: a.options ?? {} })),
    )
    server.registerTool(
      'update_custom_field',
      {
        title: 'Update custom field',
        description:
          'Rename, change options, reorder (sort_order), toggle show_in_table, or archive/unarchive a field. The type cannot change.',
        inputSchema: {
          id: z.string(),
          name: z.string().optional(),
          options: fieldOptions.optional(),
          show_in_table: z.boolean().optional(),
          sort_order: z.number().int().optional(),
          description: z.string().optional(),
          required: z.boolean().optional(),
          archived: z.boolean().optional().describe('true archives (hides) the field, false restores it.'),
        },
        annotations: { ...WRITE, title: 'Update custom field' },
      },
      run(async ({ id, ...patch }) => api.updateCustomField(id, patch)),
    )
    server.registerTool(
      'delete_custom_field',
      {
        title: 'Delete custom field',
        description:
          'Delete a field. If contacts have values it is archived (recoverable) unless purge=true, which erases the field and every stored value.',
        inputSchema: { id: z.string(), purge: z.boolean().optional(), confirm },
        annotations: { ...DESTRUCTIVE, title: 'Delete custom field' },
      },
      run(async (a) =>
        a.confirm === true ? api.deleteCustomField(a.id, a.purge) : needConfirm('this custom field'),
      ),
    )
  }

  // ------------------------------------------------------------ tables
  if (has(scopes, 'tables:read')) {
    server.registerTool(
      'list_tables',
      {
        title: 'List custom tables',
        description: 'List custom tables with column and row counts.',
        inputSchema: {},
        annotations: { ...READ, title: 'List custom tables' },
      },
      run(async () => api.listTables()),
    )
    server.registerTool(
      'get_table',
      {
        title: 'Get custom table',
        description: 'A table (by id or key) with its columns.',
        inputSchema: { table: z.string().describe('Table id or key.') },
        annotations: { ...READ, title: 'Get custom table' },
      },
      run(async ({ table }) => api.getTable(table)),
    )
    server.registerTool(
      'list_table_rows',
      {
        title: 'List table rows',
        description: 'Rows of a table, optionally searched by label. Each row has id, label and data keyed by column key.',
        inputSchema: {
          table: z.string().describe('Table id or key.'),
          search: z.string().optional(),
          limit,
          offset: z.number().int().min(0).optional(),
        },
        annotations: { ...READ, title: 'List table rows' },
      },
      run(async ({ table, ...q }) => api.listRecords(table, q)),
    )
  }
  if (has(scopes, 'tables:write')) {
    server.registerTool(
      'create_table',
      {
        title: 'Create custom table',
        description:
          'Create a table with its columns in one call (e.g. "Trainers" with Name, Phone). The first column is the row label unless label_field_key is given. A contact field of type reference can then point at it with options.table_key.',
        inputSchema: {
          name: z.string(),
          description: z.string().optional(),
          columns: z
            .array(z.object({ name: z.string(), type: fieldType, options: fieldOptions.optional(), required: z.boolean().optional() }))
            .min(1),
          label_field_key: z.string().optional(),
        },
        annotations: { ...WRITE, title: 'Create custom table' },
      },
      run(async (a) => api.createTable(a)),
    )
    server.registerTool(
      'update_table',
      {
        title: 'Update custom table',
        description: 'Rename a table, change its description or which column is the row label.',
        inputSchema: {
          table: z.string().describe('Table id or key.'),
          name: z.string().optional(),
          description: z.string().optional(),
          label_field_key: z.string().optional(),
        },
        annotations: { ...WRITE, title: 'Update custom table' },
      },
      run(async ({ table, ...patch }) => api.updateTable(table, patch)),
    )
    server.registerTool(
      'delete_table',
      {
        title: 'Delete custom table',
        description:
          'Delete a table and all its rows. Refused while a reference field still points at it (remove that field first).',
        inputSchema: { table: z.string().describe('Table id or key.'), confirm },
        annotations: { ...DESTRUCTIVE, title: 'Delete custom table' },
      },
      run(async (a) => (a.confirm === true ? api.deleteTable(a.table) : needConfirm('this table and all its rows'))),
    )
    server.registerTool(
      'create_table_row',
      {
        title: 'Add table row',
        description: 'Add a row. values is keyed by column key. Values are validated against the column types.',
        inputSchema: { table: z.string().describe('Table id or key.'), values: looseObj },
        annotations: { ...WRITE, title: 'Add table row' },
      },
      run(async ({ table, values }) => api.createRecord(table, values)),
    )
    server.registerTool(
      'update_table_row',
      {
        title: 'Update table row',
        description: 'Change values of one row (only the keys you pass change; null clears a value).',
        inputSchema: { table: z.string(), row_id: z.string(), values: looseObj },
        annotations: { ...WRITE, title: 'Update table row' },
      },
      run(async ({ table, row_id, values }) => api.updateRecord(table, row_id, values)),
    )
    server.registerTool(
      'delete_table_row',
      {
        title: 'Delete table row',
        description: 'Delete a row. Contacts that reference it have that value cleared.',
        inputSchema: { table: z.string(), row_id: z.string(), confirm },
        annotations: { ...DESTRUCTIVE, title: 'Delete table row' },
      },
      run(async (a) =>
        a.confirm === true ? api.deleteRecord(a.table, a.row_id) : needConfirm('this row'),
      ),
    )
  }

  // ---------------------------------------------------------- segments
  if (has(scopes, 'segments:read')) {
    server.registerTool(
      'list_segments',
      {
        title: 'List segments',
        description: 'List saved segments (dynamic filters over contacts).',
        inputSchema: {},
        annotations: { ...READ, title: 'List segments' },
      },
      run(async () => api.listSegments()),
    )
    server.registerTool(
      'get_segment',
      {
        title: 'Get segment',
        description: 'One segment with its filter.',
        inputSchema: { id: z.string() },
        annotations: { ...READ, title: 'Get segment' },
      },
      run(async ({ id }) => api.getSegment(id)),
    )
    server.registerTool(
      'list_segment_contacts',
      {
        title: 'List segment contacts',
        description: 'Contacts that match the segment right now, with the total. Paged with limit/offset.',
        inputSchema: { id: z.string(), limit, offset: z.number().int().min(0).optional() },
        annotations: { ...READ, title: 'List segment contacts' },
      },
      run(async ({ id, ...q }) => api.listSegmentContacts(id, q)),
    )
  }
  if (has(scopes, 'contacts:read')) {
    server.registerTool(
      'filter_contacts',
      {
        title: 'Filter contacts',
        description:
          'Find contacts with an ad hoc filter over built-in fields, tags and typed custom fields (no segment needed). count_only=true returns just the number.',
        inputSchema: {
          filter: filterSchema,
          search: z.string().optional(),
          limit,
          offset: z.number().int().min(0).optional(),
          count_only: z.boolean().optional(),
        },
        annotations: { ...READ, title: 'Filter contacts' },
      },
      run(async (a) => api.filterContacts(a)),
    )
  }
  if (has(scopes, 'segments:write')) {
    server.registerTool(
      'create_segment',
      {
        title: 'Create segment',
        description:
          'Save a dynamic segment. It is re-evaluated every time it is used (contacts list, broadcasts, automations), never frozen.',
        inputSchema: { name: z.string(), description: z.string().optional(), filter: filterSchema },
        annotations: { ...WRITE, title: 'Create segment' },
      },
      run(async (a) => api.createSegment(a)),
    )
    server.registerTool(
      'update_segment',
      {
        title: 'Update segment',
        description: 'Rename a segment or replace its filter.',
        inputSchema: {
          id: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
          filter: filterSchema.optional(),
        },
        annotations: { ...WRITE, title: 'Update segment' },
      },
      run(async ({ id, ...patch }) => api.updateSegment(id, patch)),
    )
    server.registerTool(
      'delete_segment',
      {
        title: 'Delete segment',
        description: 'Delete a segment. Contacts are not affected; broadcasts or automations using it will stop matching.',
        inputSchema: { id: z.string(), confirm },
        annotations: { ...DESTRUCTIVE, title: 'Delete segment' },
      },
      run(async (a) => (a.confirm === true ? api.deleteSegment(a.id) : needConfirm('this segment'))),
    )
  }
}
