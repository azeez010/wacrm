# MCP server

wacrm ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can drive your CRM from AI assistants — Claude Desktop,
Claude Code, Cursor, and any other MCP client — in natural language:

> "How many conversations are still open today?"
> "Show the last five messages with +1 415 555 0123."
> "Send the `order_update` template to that contact."

It lives in [`mcp-server/`](../mcp-server) and is published to npm as
[`wacrm-mcp`](https://www.npmjs.com/package/wacrm-mcp). Under the hood
it's a thin wrapper over the [public API](./public-api.md), so every
request is authenticated and scoped by your instance exactly like any
other API call.

## Quick start

1. Create an API key in the dashboard: **Settings → API keys**. Grant
   only the scopes your assistant needs (a read-only assistant only
   needs the `*:read` scopes).
2. Add the server to your MCP client config:

   ```jsonc
   {
     "mcpServers": {
       "wacrm": {
         "command": "npx",
         "args": ["-y", "wacrm-mcp"],
         "env": {
           "WACRM_BASE_URL": "https://crm.example.com",
           "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx"
         }
       }
     }
   }
   ```

That's **read-only** — the safe default. To let the assistant change
data or send messages, add `"WACRM_ENABLE_WRITES": "true"` (and
`"WACRM_ENABLE_BROADCASTS": "true"` for mass sends) to `env`.

## What it exposes

- **Reads (always on):** `whoami`, contacts (list/get), conversations
  (list/get), messages (list), broadcast status.
- **Writes (opt-in):** send a message, create/update a contact.
- **Broadcasts (opt-in):** launch a template broadcast — requires an
  explicit `confirm` and is marked destructive.

## Safety

Because sending WhatsApp messages is a real side effect, the server is
**read-only until you opt in**, layered on top of the API key's own
scopes. Give an assistant a read-only key and read-only config and it
physically cannot send anything. See the
[server README](../mcp-server/README.md) for the full tool list and
safety model.


## Custom fields, tables and segments

With the `fields`, `tables` and `segments` scopes (included in the
"Campaign builder" and "Full access" presets) Claude can design the data
model of a custom app and target contacts with it:

- `get_custom_data_reference`: field types, value formats and the filter operators per type. Claude reads this first.
- `list_custom_fields`, `create_custom_field`, `update_custom_field`, `delete_custom_field`
- `list_tables`, `get_table`, `create_table`, `update_table`, `delete_table`
- `list_table_rows`, `create_table_row`, `update_table_row`, `delete_table_row`
- `list_segments`, `get_segment`, `list_segment_contacts`, `create_segment`, `update_segment`, `delete_segment`
- `filter_contacts` (needs `contacts:read`): ad hoc filter, or `count_only` for just the number
- `create_contact` / `update_contact` take `custom_fields`; `send_broadcast` takes `segment_id` or `filter`

Deleting a field, table, row or segment needs `confirm: true`.
