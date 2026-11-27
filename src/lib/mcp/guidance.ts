/** Registers the always-available guidance: the get_playbook tool and the prompts. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { publicOrigin } from '@/lib/seo'
import { READ, text } from './helpers'
import { PLAYBOOK_TOPICS, PROMPTS, renderPlaybook } from './playbooks'

export function registerGuidance(server: McpServer) {
  server.registerTool(
    'get_playbook',
    {
      title: 'Playbook for a goal',
      description:
        'Step-by-step recipe for a goal, naming the exact tools to use and the decisions to ask the user first. Topics: ' +
        'project_kickoff (a whole project end to end: start here for "I have a project"), lead_gen (forms and follow-up), support (support button, routing), ' +
        'marketing_broadcast (send to an audience), developer_api (help a developer integrate), templates (write approvable WhatsApp templates), ' +
        'ai_agents (an AI agent that answers customers), workspaces (team, invitations and other workspaces).',
      inputSchema: { topic: z.enum(PLAYBOOK_TOPICS) },
      annotations: { ...READ, title: 'Playbook for a goal' },
    },
    async ({ topic }) => text(renderPlaybook(topic, publicOrigin())),
  )

  for (const p of PROMPTS) {
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description, argsSchema: { goal: z.string().optional().describe(p.arg) } },
      ({ goal }) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `Use OgaDesk to do this: ${goal?.trim() || p.arg}\n\n` +
                `Call get_playbook with topic "${p.topic}" and follow it. Ask me the open decisions together in one message, build everything as drafts, ` +
                'summarise, and wait for my yes before publishing, activating or messaging anyone.',
            },
          },
        ],
      }),
    )
  }
}
