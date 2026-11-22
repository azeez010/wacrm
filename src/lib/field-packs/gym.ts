import type { FieldPack } from './types'

/** Example pack: what a gym app installs. Used as the integration fixture. */
export const GYM_PACK: FieldPack = {
  key: 'gym',
  name: 'Gym',
  fields: [
    { key: 'plan', name: 'Plan', type: 'enum', options: { options: ['Basic', 'Gold', 'Platinum'] }, show_in_table: true },
    { key: 'amount', name: 'Amount', type: 'number', options: { format: 'currency' }, show_in_table: true },
    { key: 'started_date', name: 'Started date', type: 'date', show_in_table: true },
    { key: 'renews_on', name: 'Renews on', type: 'date' },
    { key: 'auto_renew', name: 'Auto-renew', type: 'bool' },
    { key: 'classes', name: 'Classes', type: 'multi_enum', options: { options: ['Yoga', 'Boxing', 'Spin', 'HIIT'] } },
    { key: 'trainer', name: 'Trainer', type: 'reference', options: { table_key: 'trainers' } },
  ],
  tables: [
    {
      key: 'trainers',
      name: 'Trainers',
      label_field_key: 'name',
      columns: [
        { key: 'name', name: 'Name', type: 'text', required: true },
        { key: 'phone', name: 'Phone', type: 'text' },
        { key: 'speciality', name: 'Speciality', type: 'text' },
      ],
    },
  ],
  segments: [
    {
      name: 'Renewing in 7 days',
      description: 'Members whose plan renews within the next week.',
      filter: {
        version: 1,
        op: 'and',
        rules: [
          { field: 'cf:@renews_on', operator: 'gte', value: 'today' },
          { field: 'cf:@renews_on', operator: 'lte', value: '+7d' },
        ],
      },
    },
    {
      name: 'Gold, auto-renewing',
      filter: {
        version: 1,
        op: 'and',
        rules: [
          { field: 'cf:@plan', operator: 'is', value: 'Gold' },
          { field: 'cf:@auto_renew', operator: 'is_true' },
        ],
      },
    },
  ],
}
