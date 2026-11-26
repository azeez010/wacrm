import type { SupabaseClient } from '@supabase/supabase-js'

// Placeholder until the Google Calendar step: keeps the registry compiling. Replaced with the real executor.
export async function runCalendarTool(
  _db: SupabaseClient,
  _integration: { id: string },
  _secrets: Record<string, string>,
  tool: string,
  _args: Record<string, unknown>,
  _f?: typeof fetch,
): Promise<{ text: string; isError: boolean }> {
  return { text: `Google Calendar is not available yet (${tool}).`, isError: true }
}
