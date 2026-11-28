import { cn } from '@/lib/utils'

const CSS = `
@media (prefers-reduced-motion: no-preference) {
  .nf-float { animation: nf-float 4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .nf-trail { animation: nf-trail 2.4s linear infinite; }
  .nf-dot { animation: nf-dot 1.2s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
  .nf-dot:nth-of-type(2) { animation-delay: .15s; }
  .nf-dot:nth-of-type(3) { animation-delay: .3s; }
  .nf-pin { animation: nf-pin 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: bottom center; }
  .nf-spark { animation: nf-spark 3s ease-in-out infinite; }
  .nf-spark:nth-of-type(2) { animation-delay: 1s; }
  .nf-spark:nth-of-type(3) { animation-delay: 2s; }
}
@keyframes nf-float { 0%,100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-10px) rotate(3deg); } }
@keyframes nf-trail { to { stroke-dashoffset: -40; } }
@keyframes nf-dot { 0%,100% { opacity: .35; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
@keyframes nf-pin { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes nf-spark { 0%,100% { opacity: 0; } 50% { opacity: 1; } }
`

/**
 * A chat bubble that lost its way: it drifts along a dashed trail away from the map pin it was sent to,
 * typing dots pulse and its delivery ticks stay grey. Colours come from theme tokens, so it follows
 * every theme and dark mode; motion stops for people who ask for reduced motion.
 */
export function NotFoundIllustration({ label, className }: { label: string; className?: string }) {
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label={label} className={cn('h-auto w-full max-w-sm', className)}>
      <style>{CSS}</style>
      {/* Soft backdrop */}
      <ellipse cx="160" cy="196" rx="120" ry="10" className="fill-muted" />
      <circle cx="160" cy="100" r="88" className="fill-primary/5" />

      {/* Sparkles */}
      <g className="text-primary" fill="currentColor">
        <path className="nf-spark" d="M48 52l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
        <path className="nf-spark" d="M272 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
        <path className="nf-spark" d="M286 150l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
      </g>

      {/* Where the message should have gone */}
      <g className="nf-pin text-primary">
        <path d="M262 176c0 0-22-24-22-38a22 22 0 0144 0c0 14-22 38-22 38z" fill="currentColor" opacity=".9" />
        <circle cx="262" cy="138" r="8" className="fill-background" />
      </g>

      {/* The wandering trail from the bubble towards nowhere */}
      <path
        className="nf-trail text-muted-foreground"
        d="M150 150c-30 30-90 20-100-10s30-50 10-70"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="2 8"
      />

      {/* The lost chat bubble */}
      <g className="nf-float">
        <path
          d="M96 46h112a18 18 0 0118 18v58a18 18 0 01-18 18h-62l-26 22v-22h-24a18 18 0 01-18-18V64a18 18 0 0118-18z"
          className="fill-card stroke-primary"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text x="152" y="100" textAnchor="middle" className="fill-foreground" fontSize="34" fontWeight="700" fontFamily="inherit">
          404
        </text>
        <g className="text-primary" fill="currentColor">
          <circle className="nf-dot" cx="138" cy="120" r="3.5" />
          <circle className="nf-dot" cx="152" cy="120" r="3.5" />
          <circle className="nf-dot" cx="166" cy="120" r="3.5" />
        </g>
        {/* Grey double tick: sent, never delivered */}
        <path
          d="M188 126l4 4 8-9M196 130l1 1 8-10"
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}
