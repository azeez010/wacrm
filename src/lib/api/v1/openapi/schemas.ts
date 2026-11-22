import { TEMPLATE_LIMITS } from '@/lib/whatsapp/template-validators'
import type { OpenApiObject } from './types'

const uuid = { type: 'string', format: 'uuid' }
const ts = { type: 'string', format: 'date-time' }

// Shared building blocks used by every path module.
export const schemas: Record<string, OpenApiObject> = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            description: 'Stable machine-readable code. Branch on this, not on `message`.',
            examples: ['bad_request'],
          },
          message: { type: 'string', description: 'Human-readable explanation. May be reworded.' },
        },
      },
    },
  },
  PageMeta: {
    type: 'object',
    properties: {
      next_cursor: {
        type: ['string', 'null'],
        description: 'Pass as `cursor` to fetch the next page. `null` means no more results.',
      },
    },
  },
  SendMessageRequest: {
    type: 'object',
    required: ['to'],
    properties: {
      to: {
        type: 'string',
        description: 'Recipient in international format with a leading `+`.',
        examples: ['+2348012345678'],
      },
      type: {
        type: 'string',
        enum: ['text', 'template', 'interactive', 'image', 'video', 'document', 'audio'],
        default: 'text',
      },
      text: {
        type: 'string',
        description: 'Message body for `text`, or the caption for media (max 1024 characters, not for audio).',
      },
      media_url: {
        type: 'string',
        format: 'uri',
        description: 'Publicly reachable URL of the file. Required for `image`, `video`, `document` and `audio`.',
      },
      filename: { type: 'string', description: 'Filename shown for `document` messages.' },
      template: {
        type: 'object',
        description: 'Required when `type` is `template`.',
        required: ['name'],
        properties: {
          name: { type: 'string', examples: ['order_update'] },
          language: { type: 'string', default: 'en_US', examples: ['en_US'] },
          params: {
            description:
              'Template variables. An array is the positional body values `{{1}}, {{2}}…`. An object gives header, body and button values.',
            oneOf: [
              { type: 'array', items: { type: 'string' }, examples: [['A123', 'Friday']] },
              {
                type: 'object',
                properties: {
                  body: { type: 'array', items: { type: 'string' } },
                  headerText: { type: 'string', description: 'Value for a text header variable.' },
                  headerMediaUrl: { type: 'string', format: 'uri', description: 'Override the template media header for this send.' },
                  headerMediaId: { type: 'string', description: 'Send the header media by Meta media id.' },
                  buttonParams: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                    description: 'Values for URL or copy-code buttons, keyed by the button index in the template.',
                  },
                },
              },
            ],
          },
        },
      },
      interactive_payload: {
        type: 'object',
        description:
          'Required when `type` is `interactive`. Either reply buttons (`kind: "buttons"`, 1 to 3 buttons) or a list (`kind: "list"`, up to 10 rows in up to 10 sections).',
        required: ['kind', 'body'],
        properties: {
          kind: { type: 'string', enum: ['buttons', 'list'] },
          body: { type: 'string', maxLength: 1024 },
          header: { type: 'string', maxLength: 60 },
          footer: { type: 'string', maxLength: 60 },
          buttons: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              required: ['id', 'title'],
              properties: { id: { type: 'string' }, title: { type: 'string', maxLength: 20 } },
            },
          },
          button_label: { type: 'string', maxLength: 20, description: 'Label of the button that opens a list.' },
          sections: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              required: ['rows'],
              properties: {
                title: { type: 'string' },
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'title'],
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string', maxLength: 24 },
                      description: { type: 'string', maxLength: 72 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      reply_to_message_id: { ...uuid, description: 'Quote an earlier message in the same conversation (its `id`).' },
      name: { type: 'string', description: 'Name for the contact, used only if the contact is created by this call.' },
    },
  },
  SendMessageResponse: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          message_id: { ...uuid, description: 'Our id for the message.' },
          whatsapp_message_id: { type: 'string', description: 'WhatsApp message id (`wamid…`).' },
          conversation_id: uuid,
          contact_id: uuid,
          contact_created: { type: 'boolean', description: 'True if this call created the contact.' },
        },
      },
    },
  },
  Message: {
    type: 'object',
    properties: {
      id: uuid,
      conversation_id: uuid,
      direction: { type: 'string', enum: ['inbound', 'outbound'] },
      sender_type: { type: 'string' },
      content_type: { type: 'string' },
      content_text: { type: ['string', 'null'] },
      media_url: { type: ['string', 'null'] },
      template_name: { type: ['string', 'null'] },
      whatsapp_message_id: { type: ['string', 'null'] },
      status: { type: 'string', enum: ['sending', 'sent', 'delivered', 'read', 'failed'] },
      reply_to_message_id: { type: ['string', 'null'] },
      interactive_reply_id: { type: ['string', 'null'] },
      created_at: ts,
    },
  },
  Template: {
    type: 'object',
    properties: {
      id: uuid,
      name: { type: 'string' },
      category: { type: 'string', enum: ['Marketing', 'Utility', 'Authentication'] },
      language: { type: 'string' },
      status: {
        type: 'string',
        description: 'Meta approval status.',
        enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION'],
      },
      header_type: { type: ['string', 'null'] },
      header_content: { type: ['string', 'null'] },
      body_text: { type: 'string' },
      footer_text: { type: ['string', 'null'] },
      buttons: { type: ['array', 'null'], items: { $ref: '#/components/schemas/TemplateButton' } },
      sample_values: { type: ['object', 'null'] },
      meta_template_id: { type: ['string', 'null'] },
      rejection_reason: { type: ['string', 'null'] },
      submission_error: { type: ['string', 'null'] },
      whatsapp_config_id: { type: ['string', 'null'] },
      last_submitted_at: { type: ['string', 'null'], format: 'date-time' },
      created_at: ts,
    },
  },
  TemplateButton: {
    oneOf: [
      {
        type: 'object',
        required: ['type', 'text'],
        properties: { type: { const: 'QUICK_REPLY' }, text: { type: 'string', maxLength: TEMPLATE_LIMITS.buttonTextMaxLength } },
      },
      {
        type: 'object',
        required: ['type', 'text', 'url'],
        properties: {
          type: { const: 'URL' },
          text: { type: 'string', maxLength: TEMPLATE_LIMITS.buttonTextMaxLength },
          url: { type: 'string', description: 'May end with `{{1}}` for a dynamic suffix (then `example` is required).' },
          example: { type: 'string' },
        },
      },
      {
        type: 'object',
        required: ['type', 'text', 'phone_number'],
        properties: {
          type: { const: 'PHONE_NUMBER' },
          text: { type: 'string', maxLength: TEMPLATE_LIMITS.buttonTextMaxLength },
          phone_number: { type: 'string' },
        },
      },
      {
        type: 'object',
        required: ['type', 'text', 'example'],
        properties: {
          type: { const: 'COPY_CODE' },
          text: { type: 'string', maxLength: TEMPLATE_LIMITS.buttonTextMaxLength },
          example: { type: 'string' },
        },
      },
    ],
  },
  CreateTemplateRequest: {
    type: 'object',
    required: ['name', 'category', 'language', 'body_text'],
    properties: {
      name: { type: 'string', pattern: TEMPLATE_LIMITS.nameRegex.source, description: 'Lowercase letters, digits and underscores.' },
      category: { type: 'string', enum: ['Marketing', 'Utility'] },
      language: { type: 'string', examples: ['en_US'], description: 'Exact Meta language code; `en` and `en_US` are different.' },
      header_type: { type: 'string', enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] },
      header_content: { type: 'string', maxLength: TEMPLATE_LIMITS.headerTextMaxLength, description: 'Header text for `TEXT` headers.' },
      header_media_url: { type: 'string', format: 'uri', description: 'Public sample file for media headers.' },
      header_handle: { type: 'string', description: 'Meta resumable-upload handle, as an alternative to `header_media_url`.' },
      body_text: { type: 'string', maxLength: TEMPLATE_LIMITS.bodyMaxLength, examples: ['Hello {{1}}, your order {{2}} is confirmed.'] },
      footer_text: { type: 'string', maxLength: TEMPLATE_LIMITS.footerMaxLength },
      buttons: { type: 'array', maxItems: TEMPLATE_LIMITS.maxButtonsTotal, items: { $ref: '#/components/schemas/TemplateButton' } },
      sample_values: {
        type: 'object',
        description: 'Example values Meta uses to review variables. Required when the body or header uses `{{n}}`.',
        properties: { body: { type: 'array', items: { type: 'string' } }, header: { type: 'array', items: { type: 'string' } } },
      },
      whatsapp_config_id: { ...uuid, description: 'Required when the workspace has more than one WhatsApp number.' },
    },
  },
  WebhookEndpoint: {
    type: 'object',
    properties: {
      id: uuid,
      url: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string' } },
      is_active: { type: 'boolean' },
      last_delivery_at: { type: ['string', 'null'], format: 'date-time' },
      failure_count: { type: 'integer' },
      created_at: ts,
    },
  },
}
