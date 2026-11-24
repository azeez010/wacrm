export const MAX_CONSECUTIVE_FAILURES_UI = 15;

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

export interface Delivery {
  id: string;
  event: string;
  event_id: string | null;
  ok: boolean;
  status_code: number | null;
  duration_ms: number | null;
  error: string | null;
  response_snippet: string | null;
  payload: unknown;
  resent_from: string | null;
  created_at: string;
}

/** next-intl keys can't contain dots, so event names map to flat keys. */
export const EVENT_LABEL_KEY: Record<string, string> = {
  'message.received': 'eventMessageReceived',
  'message.status_updated': 'eventMessageStatusUpdated',
  'conversation.created': 'eventConversationCreated',
  'form.submitted': 'eventFormSubmitted',
};
export const EVENT_DESC_KEY: Record<string, string> = {
  'message.received': 'eventMessageReceivedDesc',
  'message.status_updated': 'eventMessageStatusUpdatedDesc',
  'conversation.created': 'eventConversationCreatedDesc',
  'form.submitted': 'eventFormSubmittedDesc',
};
