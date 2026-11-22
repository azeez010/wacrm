// Client-safe list (templates.ts pulls in the server-side translator).
export const TEMPLATE_SLUGS = ['blank', 'contact', 'newsletter', 'webinar', 'quote', 'event', 'support'] as const
export type TemplateSlug = (typeof TEMPLATE_SLUGS)[number]
