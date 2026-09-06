import { BrandMark } from "@/components/brand/BrandMark";
import { PUBLIC_BRAND_NAME } from "@/lib/brand";

type BrandWordmarkProps = {
  className?: string;
  /** light = navy word on light bg; dark = off-white word on navy/marketing */
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg" | "hero";
  markClassName?: string;
};

const sizeClasses = {
  sm: "text-base gap-0.5",
  md: "text-xl gap-0.5",
  lg: "text-2xl gap-1",
  hero: "text-4xl gap-1 sm:text-5xl md:text-6xl",
} as const;

const markSizeClasses = {
  sm: "h-[1.05em] w-[0.95em]",
  md: "h-[1.1em] w-[1em]",
  lg: "h-[1.15em] w-[1.05em]",
  hero: "h-[1.05em] w-[0.95em]",
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
      className={`inline-flex items-baseline font-display font-semibold tracking-tight ${sizeClasses[size]} ${className}`}
      aria-label={PUBLIC_BRAND_NAME}
    >
      <span className={wordColor}>RankEye</span>
      <BrandMark
        className={`relative top-[0.06em] shrink-0 text-accent ${markSizeClasses[size]} ${markClassName}`}
      />
    </span>
  );
}
