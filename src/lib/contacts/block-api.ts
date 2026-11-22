async function mutateBlock(contactId: string, method: 'POST' | 'DELETE'): Promise<{ changed: boolean }> {
  const response = await fetch(`/api/contacts/${contactId}/block`, { method });
  const body = (await response.json().catch(() => ({}))) as { error?: string; changed?: boolean };
  if (!response.ok) throw new Error(body.error ?? 'Failed to update contact');
  return { changed: body.changed !== false };
}

export function blockContact(contactId: string) {
  return mutateBlock(contactId, 'POST');
}

export function unblockContact(contactId: string) {
  return mutateBlock(contactId, 'DELETE');
}
