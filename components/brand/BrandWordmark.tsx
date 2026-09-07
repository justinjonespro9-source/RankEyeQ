import { BrandMark } from "@/components/brand/BrandMark";
import { PUBLIC_BRAND_NAME } from "@/lib/brand";

type BrandWordmarkProps = {
  className?: string;
  /** light = navy word on light bg; dark = off-white word on navy/marketing */
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg" | "hero";
  markClassName?: string;
};

/**
 * Inter-letter gap between “e” and Q — ~30% tighter than prior gap-0.5 / gap-1
 * so the mark joins the word instead of reading as a trailing icon.
 */
const sizeClasses = {
  sm: "text-base gap-[0.085em]",
  md: "text-xl gap-[0.085em]",
  lg: "text-2xl gap-[0.12em]",
  hero: "text-4xl gap-[0.12em] sm:text-5xl md:text-6xl",
} as const;

/**
 * BrandMark viewBox is 40×44. The Q bowl (circle r=12.25 at cy=17.5) has
 * diameter 24.5; the descender/tail continues below y=29.75.
 *
 * Size so the bowl sits at ~cap-height with optical overshoot for a circular
 * ring (solid caps measure ~0.75em in Space Grotesk; target bowl ~0.85em /
 * ~13% overshoot so the open teal ring does not read undersized).
 *
 * SVG height = 0.85 / (24.5/44) ≈ 1.53em
 * Width keeps the 40∶44 aspect ≈ 1.39em
 * Baseline nudge = height × ((44 − 29.75) / 44) ≈ 0.50em so the bowl rests
 * on the alphabetic baseline and the tail descends like a true Q.
 *
 * Horizontal join: flex gap (~30% tighter) plus -ml-[0.1em] pulls the bowl
 * toward the final “e”, eating unused left viewBox padding without clipping.
 */
const markSizeClasses = {
  sm: "h-[1.53em] w-[1.39em]",
  md: "h-[1.53em] w-[1.39em]",
  lg: "h-[1.53em] w-[1.39em]",
  hero: "h-[1.53em] w-[1.39em]",
} as const;

/**
 * RankEyeQ wordmark: RankEye in ink/off-white + teal monocle Q mark.
 */
export function BrandWordmark({
  className = "",
  variant = "light",
  size = "md",
  markClassName = "",
}: BrandWordmarkProps) {
  const wordColor = variant === "dark" ? "text-off-white" : "text-ink";

  return (
    <span
      className={`inline-flex items-baseline overflow-visible font-display font-semibold tracking-tight ${sizeClasses[size]} ${className}`}
      aria-label={PUBLIC_BRAND_NAME}
    >
      <span className={wordColor}>RankEye</span>
      <BrandMark
        treatment="letter"
        className={`relative top-[0.5em] -ml-[0.1em] shrink-0 text-accent ${markSizeClasses[size]} ${markClassName}`}
      />
    </span>
  );
}
