import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { channelOf, type ChannelId } from '@/lib/channels/registry'

/** WhatsApp glyph (the same speech-bubble-and-handset path the support widget uses). */
function WhatsAppGlyph({ style }: { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden style={style}>
      <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.4 2.5 1.5.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z" />
    </svg>
  )
}

const STYLE: Record<ChannelId, { bg: string; Icon: (p: { style?: React.CSSProperties }) => React.ReactElement; glyph: number }> = {
  whatsapp: { bg: 'bg-[#25D366]', Icon: WhatsAppGlyph, glyph: 0.78 },
  web_chat: { bg: 'bg-sky-500', Icon: ({ style }) => <Globe aria-hidden style={style} strokeWidth={2.5} />, glyph: 0.6 },
}

/**
 * Small circular channel marker. Position it with `className` (the inbox puts
 * it at the bottom-left of an avatar); `label` is the channel's display name.
 */
export function ChannelBadge({
  channel,
  label,
  className,
  size = 16,
}: {
  channel: string | null | undefined
  label: string
  className?: string
  size?: number
}) {
  const id = channelOf({ channel })
  const { bg, Icon, glyph } = STYLE[id]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-white ring-2 ring-background',
        bg,
        className,
      )}
    >
      <Icon style={{ width: size * glyph, height: size * glyph }} />
    </span>
  )
}
