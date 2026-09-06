import { BrandWordmark } from "@/components/brand/BrandWordmark";

type BrandNameProps = {
  className?: string;
  /** @deprecated Prefer BrandWordmark `variant`. Kept for call-site compatibility. */
  accentClassName?: string;
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg" | "hero";
};

/**
 * Public RankEyeQ wordmark. Prefer {@link BrandWordmark} for new call sites.
 */
export function BrandName({
  className = "",
  variant = "light",
  size = "md",
}: BrandNameProps) {
  return <BrandWordmark className={className} variant={variant} size={size} />;
}
