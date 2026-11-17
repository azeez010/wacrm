/**
 * Authoring references served by the MCP `get_automation_reference` and
 * `get_flow_reference` tools. These are what let an AI assistant build
 * valid automations / flows without guessing shapes: every trigger,
 * step and node type, its exact config, limits, and a worked example.
 *
 * Keep in sync with src/lib/automations/validate.ts, src/types/index.ts
 * (automation configs) and src/lib/flows/{types,validate}.ts.
 */

export const AUTOMATION_REFERENCE = {
  overview:
    'An automation = ONE trigger + an ordered list of steps that run top to bottom. Create it with create_automation (saved as an inactive DRAFT), check `activation_issues` in the response (must be empty before it can go live), then call update_automation with is_active=true. Use validate_automation to dry-run a definition without saving.',
  build_order: [
    '1. Gather ids first: list_tags / create_tag (tag steps & triggers), list_pipelines (create_deal needs pipeline_id AND stage_id), list_team_members (assign_conversation), list_templates (send_template must name an APPROVED template).',
    '2. create_automation as a draft. 3. Fix everything in activation_issues. 4. update_automation {is_active:true}.',
  ],
  triggers: {
    new_message_received: { config: {}, when: 'Every inbound message from a contact.' },
    first_inbound_message: { config: {}, when: "A contact's very first inbound message (best for welcome messages)." },
    keyword_match: {
      config: { keywords: ['price', 'pricing'], match_type: 'contains | exact | word (default contains)', case_sensitive: 'optional boolean' },
      when: 'Inbound text matches any keyword. Prefer match_type "word" for short keywords (contains matches inside longer words).',
    },
    new_contact_created: { config: {}, when: 'A new contact is created.' },
    conversation_assigned: { config: {}, when: 'A conversation is assigned to an agent.' },
    tag_added: { config: { tag_id: 'uuid' }, when: 'That tag is added to a contact. Great for drip sequences: tag → welcome → wait → follow-up.' },
    time_based: { config: { schedule: 'cron expression or "HH:mm"', timezone: 'IANA tz, optional' }, when: 'On a schedule.' },
    interactive_reply: {
      config: { reply_ids: ['btn_yes'] },
      when: 'Customer taps a reply button / list row whose id matches. Chain multi-step menus across automations.',
    },
  },
  steps: {
    send_message: { config: { text: 'Hi {{vars.name}}!' }, note: 'Free-form text. WhatsApp only allows this within 24h of the customer\'s last message — use send_template outside that window.' },
    send_buttons: {
      config: { kind: 'buttons', body: 'Choose one', header: 'optional ≤60', footer: 'optional ≤60', buttons: [{ id: 'btn_yes', title: 'Yes (≤20 chars)' }], wait_for_reply: 'optional boolean — pause until the customer answers' },
      limits: '1–3 buttons, unique ids, body ≤1024. Use an interactive_reply trigger on the button id to branch into another automation.',
    },
    send_list: {
      config: { kind: 'list', body: 'Pick a topic', button_label: 'Open menu (≤20)', sections: [{ title: 'optional', rows: [{ id: 'row_1', title: '≤24 chars', description: 'optional ≤72' }] }], wait_for_reply: 'optional boolean' },
      limits: '1–10 rows total, unique ids.',
    },
    send_template: { config: { template_name: 'order_update', language: 'en_US', variables: { '1': 'value for {{1}}' } }, note: 'Must be an APPROVED template (list_templates). Required to message outside the 24h window.' },
    add_tag: { config: { tag_id: 'uuid' } },
    remove_tag: { config: { tag_id: 'uuid' } },
    assign_conversation: { config: { mode: 'specific | round_robin', agent_id: 'user_id from list_team_members (required when specific)' } },
    update_contact_field: { config: { field: 'name | email | company | custom:<custom_field_id>', value: 'text, may use {{message.text}} / {{vars.x}}' } },
    create_deal: { config: { pipeline_id: 'uuid', stage_id: 'uuid in that pipeline', title: 'Deal for {{vars.name}}', value: 0 } },
    wait: { config: { amount: 2, unit: 'minutes | hours | days' }, note: 'Pauses the run, then continues with the next step. This is how you build follow-up sequences.' },
    condition: {
      config: {
        subject: 'contact_field | tag_presence | message_content | time_of_day',
        operand: 'contact_field: field name · tag_presence: tag id · time_of_day: "HH:mm-HH:mm" · (not needed for message_content)',
        value: 'contact_field / message_content: the text to compare',
        timezone: 'time_of_day only, optional',
      },
      branches: '{ "yes": [ ...steps ], "no": [ ...steps ] } — nest steps here. Only condition steps have branches.',
    },
    send_webhook: { config: { url: 'https://…', headers: {}, body_template: 'optional' }, note: 'http(s) only.' },
    close_conversation: { config: {} },
  },
  interpolation: 'Where supported, {{message.text}} inserts the inbound message and {{vars.key}} a stored variable. Unknown keys render empty.',
  example: {
    name: 'Webinar lead nurture',
    description: 'Tag → welcome → wait a day → follow up',
    trigger_type: 'tag_added',
    trigger_config: { tag_id: '<tag uuid>' },
    steps: [
      { step_type: 'send_template', step_config: { template_name: 'webinar_welcome', language: 'en_US' } },
      { step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
      {
        step_type: 'condition',
        step_config: { subject: 'tag_presence', operand: '<replied tag uuid>' },
        branches: {
          yes: [{ step_type: 'close_conversation', step_config: {} }],
          no: [{ step_type: 'send_template', step_config: { template_name: 'webinar_followup', language: 'en_US' } }],
        },
      },
    ],
  },
  tips: [
    'Always read back activation_issues; a draft can be incomplete, a live automation cannot.',
    'Several automations can match one message — keep triggers specific to avoid double replies.',
    'Never activate something that messages real customers without the user confirming the wording.',
  ],
}

export const FLOW_REFERENCE = {
  overview:
    'A flow is a conversational graph: nodes connected by `next_node_key` references (edges live inside each node config). A customer enters via the trigger, then moves node to node — menus wait for a button/list tap, collect_input waits for free text. Create with create_flow (DRAFT), inspect `issues` (severity error blocks activation; warning is advisory), then set_flow_status "active". Use validate_flow to dry-run.',
  build_order: [
    '1. Gather ids: list_tags (set_tag / condition), list_team_members (handoff assign_to).',
    '2. Design nodes with unique node_key strings (e.g. "welcome", "menu", "ask_name"). 3. create_flow with entry_node_id = the key of your `start` node. 4. Fix every error in `issues`. 5. set_flow_status active.',
  ],
  triggers: {
    keyword: { config: { keywords: ['menu', 'start'], match_type: 'contains | exact (default contains)', case_sensitive: 'optional' }, when: 'Inbound text (or tapped button title/id) matches.' },
    first_inbound_message: { config: {}, when: "A contact's first-ever inbound message." },
    manual: { config: {}, when: 'Started by an agent from the inbox.' },
  },
  nodes: {
    start: { config: { next_node_key: 'welcome' }, note: 'Entry node. entry_node_id on the flow must equal its node_key.' },
    send_message: { config: { text: 'Hi {{vars.name}}', next_node_key: '…' }, note: 'Auto-advances after sending.' },
    send_buttons: {
      config: { text: 'How can we help?', header_text: 'optional', footer_text: 'optional', buttons: [{ reply_id: 'sales', title: 'Sales (≤20)', next_node_key: 'sales_intro' }] },
      limits: '1–3 buttons, unique reply_id, every button needs next_node_key. WAITS for the tap.',
    },
    send_list: {
      config: { text: 'Pick a topic', button_label: 'Topics (≤20)', sections: [{ title: 'optional', rows: [{ reply_id: 'billing', title: '≤24', description: 'optional ≤72', next_node_key: 'billing_help' }] }] },
      limits: '1–10 rows total across sections, unique reply_id, each row needs next_node_key. WAITS for the selection.',
    },
    send_media: { config: { media_type: 'image | video | document', media_url: 'public https URL', caption: 'optional ≤1024', filename: 'documents only', next_node_key: '…' } },
    collect_input: {
      config: { prompt_text: 'What is your name?', var_key: 'name', validation: 'any (others reserved)', next_node_key: '…' },
      note: 'Sends the prompt, waits for free text, stores it in vars[var_key] (usable as {{vars.name}} later).',
    },
    condition: {
      config: { subject: 'var | tag | contact_field', subject_key: 'var: key in vars · tag: tag uuid · contact_field: name|email|phone|company', operator: 'equals | contains | present | absent', value: 'for equals/contains', true_next: 'node_key', false_next: 'node_key' },
      note: 'Routes instantly, no message sent.',
    },
    set_tag: { config: { mode: 'add | remove', tag_id: 'uuid', next_node_key: '…' } },
    handoff: { config: { note: 'optional internal note', assign_to: 'optional user_id from list_team_members' }, note: 'Hands the chat to a human. Terminal.' },
    end: { config: {}, note: 'Terminal — stops the run.' },
  },
  rules: [
    'node_key values are unique strings; every next_node_key / true_next / false_next must point at an existing node.',
    'Auto-advancing nodes (send_message, send_media, set_tag, condition, collect_input after capture) must not form a loop with no waiting node in it.',
    'Unreachable nodes are warnings. A flow needs a name, a trigger, an entry_node_id and at least one node to activate.',
    'reply_id is the routing key — keep it stable, short and unique across the flow.',
  ],
  fallback_policy: {
    note: 'Optional. What to do when a customer replies off-menu or goes quiet.',
    default: { on_unknown_reply: 'reprompt', max_reprompts: 2, on_timeout_hours: 24, on_exhaust: 'handoff' },
  },
  example: {
    name: 'Support menu',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['help', 'support'] },
    entry_node_id: 'start',
    nodes: [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'ask_name' } },
      { node_key: 'ask_name', node_type: 'collect_input', config: { prompt_text: 'Hi! What should we call you?', var_key: 'name', next_node_key: 'menu' } },
      {
        node_key: 'menu',
        node_type: 'send_buttons',
        config: {
          text: 'Thanks {{vars.name}}! What do you need?',
          buttons: [
            { reply_id: 'orders', title: 'My order', next_node_key: 'human' },
            { reply_id: 'other', title: 'Something else', next_node_key: 'human' },
          ],
        },
      },
      { node_key: 'human', node_type: 'handoff', config: { note: 'Customer asked for help from the menu' } },
    ],
  },
}
