/** Builds a click-to-chat link (https://wa.me/<number>?text=...). Returns null until the number looks valid. */
export function buildWaLink(rawNumber: string, message = ''): string | null {
  const digits = rawNumber.replace(/[^\d]/g, '').replace(/^00/, '')
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null
  const text = message.trim()
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}
