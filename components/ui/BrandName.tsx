import { PUBLIC_BRAND_NAME } from "@/lib/brand";

type BrandNameProps = {
  className?: string;
  accentClassName?: string;
};

/**
 * Accessible brand text: RankEyeQ with optional split styling for Rank / EyeQ.
 */
export function BrandName({
  className = "",
  accentClassName = "text-accent",
}: BrandNameProps) {
  return (
    <span className={className} aria-label={PUBLIC_BRAND_NAME}>
      <span>Rank</span>
      <span className={accentClassName}>EyeQ</span>
    </span>
  );
}
