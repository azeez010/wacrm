// Click-to-edit in the live preview: the edit message and how it maps to editor state.

export type PreviewEdit =
  | { kind: 'setting'; key: 'title' | 'description' | 'buttonText'; value: string }
  | { kind: 'field'; fieldId: string; key: 'label' | 'help' | 'text' | 'consentText'; value: string }
  | { kind: 'greeting'; value: string }

const MAX: Record<string, number> = { title: 200, buttonText: 200, label: 200, help: 200, description: 2000, text: 2000, consentText: 2000, greeting: 200 }

/** Parse an untrusted message payload into an edit, or null. */
export function parsePreviewEdit(raw: unknown): PreviewEdit | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.value !== 'string') return null
  const clip = (key: string) => e.value!.toString().slice(0, MAX[key] ?? 200)
  if (e.kind === 'setting' && (e.key === 'title' || e.key === 'description' || e.key === 'buttonText')) return { kind: 'setting', key: e.key, value: clip(e.key) }
  if (e.kind === 'greeting') return { kind: 'greeting', value: clip('greeting') }
  if (e.kind === 'field' && typeof e.fieldId === 'string' && (e.key === 'label' || e.key === 'help' || e.key === 'text' || e.key === 'consentText')) {
    return { kind: 'field', fieldId: e.fieldId, key: e.key, value: clip(e.key) }
  }
  return null
}

/** The editor-state action an edit turns into (same actions the side panels dispatch). */
export function previewEditAction(edit: PreviewEdit):
  | { type: 'settings'; patch: Record<string, unknown> }
  | { type: 'update'; id: string; patch: Record<string, string> } {
  if (edit.kind === 'setting') return { type: 'settings', patch: { [edit.key]: edit.value } }
  if (edit.kind === 'greeting') return { type: 'settings', patch: { widget: { greeting: edit.value } } }
  return { type: 'update', id: edit.fieldId, patch: { [edit.key]: edit.value } }
}
