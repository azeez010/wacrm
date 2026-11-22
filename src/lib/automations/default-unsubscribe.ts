import { getT } from '@/lib/i18n/translate'
import type { BuilderStepInput } from './steps-tree'

export const UNSUBSCRIBE_SYSTEM_KEY = 'unsubscribe'
export const UNSUBSCRIBE_YES_ID = 'unsub_yes'
export const UNSUBSCRIBE_NO_ID = 'unsub_no'

const t = getT('DefaultAutomations')

export interface DefaultAutomationDefinition {
  system_key: string
  name: string
  description: string
  trigger_type: 'keyword_match'
  trigger_config: { keywords: string[]; match_type: 'word'; case_sensitive: false }
  steps: BuilderStepInput[]
}

/**
 * The default "Unsubscribe" automation every account gets once. Nothing is
 * blocked on a keyword alone: the contact must tap Yes on a confirmation
 * message first. The goodbye message is sent BEFORE the block step, since a
 * blocked contact can no longer be messaged.
 */
export function buildUnsubscribeAutomation(): DefaultAutomationDefinition {
  return {
    system_key: UNSUBSCRIBE_SYSTEM_KEY,
    name: t('unsubscribe.name'),
    description: t('unsubscribe.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: t('unsubscribe.keywords')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      match_type: 'word',
      case_sensitive: false,
    },
    steps: [
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: t('unsubscribe.question'),
          buttons: [
            { id: UNSUBSCRIBE_YES_ID, title: t('unsubscribe.yes') },
            { id: UNSUBSCRIBE_NO_ID, title: t('unsubscribe.no') },
          ],
          wait_for_reply: true,
        },
      },
      {
        step_type: 'condition',
        step_config: { subject: 'reply_id', operand: UNSUBSCRIBE_YES_ID },
        branches: {
          yes: [
            { step_type: 'send_message', step_config: { text: t('unsubscribe.confirmed') } },
            { step_type: 'block_contact', step_config: {} },
          ],
          no: [{ step_type: 'send_message', step_config: { text: t('unsubscribe.kept') } }],
        },
      },
    ],
  }
}
