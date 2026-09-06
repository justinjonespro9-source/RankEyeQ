import { displayInitials } from "@/lib/avatar";

const SIZE_CLASS = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl",
} as const;

/**
 * Round identity avatar used on profiles, leaderboards, and account chrome.
 * Pass a resolved src (uploaded or Google); omit/null for initials.
 */
export function ProfileAvatar({
  name,
  src = null,
  size = "md",
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent-ink ${SIZE_CLASS[size]} ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote OAuth + Blob URLs
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        displayInitials(name)
      )}
    </span>
  );
}
