import { Globe, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { channelOf, type ChannelId } from '@/lib/channels/registry'

const STYLE: Record<ChannelId, { bg: string; Icon: typeof Phone }> = {
  whatsapp: { bg: 'bg-[#25D366]', Icon: Phone },
  web_chat: { bg: 'bg-sky-500', Icon: Globe },
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
  const { bg, Icon } = STYLE[id]
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
      <Icon aria-hidden style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.5} />
    </span>
  )
}
