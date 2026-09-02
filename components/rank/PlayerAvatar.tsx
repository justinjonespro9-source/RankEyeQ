import type { RankingPlayer } from "@/types/contest";

function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function PlayerAvatar({
  player,
  size = "md",
}: {
  player: RankingPlayer;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-8 w-8 text-[10px]" : "h-10 w-10 text-xs";

  if (player.headshotUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={player.headshotUrl}
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover ring-1 ring-border`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent ring-1 ring-accent/15`}
    >
      {initials(player.name)}
    </span>
  );
}
