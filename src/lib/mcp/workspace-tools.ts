/**
 * MCP tools for managing the workspace a key belongs to (workspace:read / workspace:manage) and, for the person
 * who created the key, their other workspaces (workspaces:manage). Ownership transfer is deliberately not here.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ApiClient } from './dispatch'
import { DESTRUCTIVE, READ, WRITE, errorResult, has, run } from './helpers'

const confirmField = z.boolean().describe('Must be true. Confirm with the user first.')
const role = z.enum(['admin', 'agent', 'viewer']).describe('admin: everything but billing/ownership · agent: inbox and contacts · viewer: read only.')

export function registerWorkspaceTools(server: McpServer, api: ApiClient, scopes: string[]) {
  if (has(scopes, 'workspace:read')) {
    server.registerTool(
      'get_workspace',
      {
        title: 'Get workspace',
        description: 'This workspace: name, timezone, currency, plan, owner and how many members it has per role.',
        inputSchema: {},
        annotations: { ...READ, title: 'Get workspace' },
      },
      run(async () => api.getWorkspace()),
    )
    server.registerTool(
      'list_invitations',
      {
        title: 'List invitations',
        description: 'Pending invitations to this workspace (role, label, expiry). Invite links are only shown when created.',
        inputSchema: {},
        annotations: { ...READ, title: 'List invitations' },
      },
      run(async () => api.listInvitations()),
    )
  }

  if (has(scopes, 'workspace:manage')) {
    server.registerTool(
      'update_workspace',
      {
        title: 'Update workspace',
        description: 'Rename this workspace and/or change its timezone (IANA, e.g. Africa/Lagos). Confirm the new name with the user.',
        inputSchema: {
          name: z.string().min(1).max(80).optional(),
          timezone: z.string().optional().describe('IANA time zone, e.g. Africa/Lagos'),
        },
        annotations: { ...WRITE, title: 'Update workspace' },
      },
      run(async (a) => api.updateWorkspace(a)),
    )
    server.registerTool(
      'create_invitation',
      {
        title: 'Invite a teammate',
        description:
          'Create a one-time invite link for this workspace. Give the url to the user to share; it is shown only now. Members plus pending invitations count toward the plan seat limit (get_plan).',
        inputSchema: {
          role: role.optional().describe('Default agent.'),
          label: z.string().max(80).optional().describe('Who it is for, e.g. "Ada (sales)".'),
          expires_in_days: z.number().int().min(1).max(30).optional(),
        },
        annotations: { ...WRITE, title: 'Invite a teammate' },
      },
      run(async (a) => api.createInvitation(a)),
    )
    server.registerTool(
      'revoke_invitation',
      {
        title: 'Revoke invitation',
        description: 'Revoke a pending invitation; its link stops working.',
        inputSchema: { id: z.string(), confirm: confirmField },
        annotations: { ...DESTRUCTIVE, title: 'Revoke invitation' },
      },
      run(async ({ id, confirm }) =>
        confirm === true ? api.revokeInvitation(id) : errorResult('Refusing: confirm must be true. Ask the user, then call again with confirm=true.'),
      ),
    )
    server.registerTool(
      'update_member_role',
      {
        title: 'Change member role',
        description: 'Change a member role (user_id from list_team_members). Never the owner or the person who created this key; ownership is transferred only in the app.',
        inputSchema: { user_id: z.string(), role },
        annotations: { ...WRITE, title: 'Change member role' },
      },
      run(async ({ user_id, role }) => api.updateMember(user_id, { role })),
    )
    server.registerTool(
      'remove_member',
      {
        title: 'Remove member',
        description:
          'Remove someone from this workspace. Their conversations are unassigned; they keep (or get) a workspace of their own. Never the owner or the key creator.',
        inputSchema: { user_id: z.string(), confirm: confirmField },
        annotations: { ...DESTRUCTIVE, title: 'Remove member' },
      },
      run(async ({ user_id, confirm }) =>
        confirm === true ? api.removeMember(user_id) : errorResult('Refusing: confirm must be true. Ask the user, then call again with confirm=true.'),
      ),
    )
  }

  if (has(scopes, 'workspaces:manage')) {
    server.registerTool(
      'list_workspaces',
      {
        title: 'List my workspaces',
        description:
          'Every workspace the person who created this key belongs to, with their role and plan; this_key marks the one this key works in. A key only ever acts in its own workspace.',
        inputSchema: {},
        annotations: { ...READ, title: 'List my workspaces' },
      },
      run(async () => api.listWorkspaces()),
    )
    server.registerTool(
      'create_workspace',
      {
        title: 'Create workspace',
        description:
          'Create a new workspace owned by the key creator (the plan workspaces limit applies; on plan_limit give the user upgrade_url from get_plan). It comes with the default pipelines. To work in it, the user creates an API key inside it.',
        inputSchema: { name: z.string().min(1).max(80) },
        annotations: { ...WRITE, title: 'Create workspace' },
      },
      run(async ({ name }) => api.createWorkspace({ name })),
    )
  }
}
