const PREFIX_RE = /^\(\d+\+?\)\s+/;

/** Strip any "(n) " badge we added earlier. */
export function stripUnreadPrefix(title: string): string {
  return title.replace(PREFIX_RE, "");
}

/**
 * WhatsApp-Web style tab title: "(3) Inbox - OgaDesk". The count is the
 * number of conversations with unread messages; 0 removes the badge.
 */
export function withUnreadPrefix(title: string, count: number): string {
  const base = stripUnreadPrefix(title);
  if (!Number.isFinite(count) || count <= 0) return base;
  const label = count > 99 ? "99+" : String(Math.floor(count));
  return `(${label}) ${base}`;
}
