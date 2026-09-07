/**
 * Standalone RankEyeQ Q mark — teal monocle / magnifier with logo-only iris.
 * Artwork lives inline for now; replace with `/public/brand/q-mark.svg` (or PNG)
 * when final production assets are ready.
 *
 * `treatment="letter"` shortens the tail for in-wordmark use so the mark reads as
 * a capital Q. Default standalone treatment (favicons, badges) is unchanged.
 */
type BrandMarkProps = {
  className?: string;
  title?: string;
  /** standalone = full magnifier handle; letter = shorter Q descender for wordmarks */
  treatment?: "standalone" | "letter";
};

/** Full handle — default for badges / favicon-style marks. */
const TAIL_STANDALONE = "M26.8 26.2 L35.2 38.4";
/** ~30% shorter descender — wordmark letter Q, not a detached magnifier. */
const TAIL_LETTER = "M26.8 26.2 L32.6 34.8";

export function BrandMark({
  className = "h-7 w-7",
  title,
  treatment = "standalone",
}: BrandMarkProps) {
  const tailPath = treatment === "letter" ? TAIL_LETTER : TAIL_STANDALONE;

  return (
    <svg
      className={className}
      viewBox="0 0 40 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {/* Magnifier rim / Q bowl */}
      <circle
        cx="18"
        cy="17.5"
        r="12.25"
        stroke="currentColor"
        strokeWidth="3.25"
      />
      {/* Realistic iris (logo detail only — not a UI accent token) */}
      <circle cx="18" cy="17.5" r="7.25" fill="#5c3a1c" />
      <circle cx="18" cy="17.5" r="5.6" fill="#7a4f28" />
      <circle cx="18" cy="17.5" r="3.2" fill="#1a1208" />
      <circle cx="15.55" cy="15.15" r="1.2" fill="#f7f9fa" fillOpacity="0.55" />
      {/* Q tail / handle */}
      <path
        d={tailPath}
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
      />
    </svg>
  );
}
