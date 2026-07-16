// Shared brand mark + wordmark, so the sidebar and auth pages stay in sync.

const SIZES = {
  md: { tile: "h-9 w-9 rounded-[0.7rem]", glyph: 19, text: "text-[13px]" },
  lg: { tile: "h-11 w-11 rounded-xl", glyph: 23, text: "text-base" },
} as const;

type Size = keyof typeof SIZES;

/** The gradient tile with a "recurring cycle" glyph — evokes subscriptions. */
export function BrandMark({
  size = "md",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div
      className={`flex ${s.tile} shrink-0 items-center justify-center bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30 ring-1 ring-inset ring-white/25 ${className}`}
    >
      <svg
        width={s.glyph}
        height={s.glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 12a7.5 7.5 0 0 1 12.4-5.6" />
        <path d="M19.5 12a7.5 7.5 0 0 1-12.4 5.6" />
        <path d="M17.6 3.1v3.3h-3.3" />
        <path d="M6.4 20.9v-3.3h3.3" />
      </svg>
    </div>
  );
}

/** Two-line "Subscription / Tracker" wordmark with an emerald accent line. */
export function Wordmark({
  size = "md",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <div className={`leading-[1.05] ${className}`}>
      <div className={`${s.text} font-semibold tracking-tight`}>
        Subscription
      </div>
      <div
        className={`${s.text} font-semibold tracking-tight text-emerald-600 dark:text-emerald-400`}
      >
        Tracker
      </div>
    </div>
  );
}

/** Full lockup (mark + wordmark), used on the auth pages. */
export function Brand({
  size = "md",
  className = "",
}: {
  size?: Size;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <Wordmark size={size} />
    </div>
  );
}
