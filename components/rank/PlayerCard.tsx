import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { PlayerAvatar } from "@/components/rank/PlayerAvatar";
import {
  AVAILABILITY_SHORT_LABEL,
  type WeeklyAvailability,
} from "@/lib/eligibility/weekly-status";
import type { PlayerAvailability, RankingPlayer } from "@/types/contest";

const AVAILABILITY_TONE: Record<
  PlayerAvailability,
  "success" | "warning" | "neutral" | "danger"
> = {
  active: "success",
  questionable: "warning",
  doubtful: "warning",
  out: "danger",
  ir: "danger",
  pup: "danger",
  suspended: "danger",
  free_agent: "neutral",
  inactive: "neutral",
};

function availabilityLabel(availability: PlayerAvailability): string {
  const key = availability.toUpperCase() as WeeklyAvailability;
  if (availability === "active") return "Active";
  return AVAILABILITY_SHORT_LABEL[key] ?? availability.toUpperCase();
}

function PlayerCardBody({
  player,
  ranked,
  compact,
  trailing,
}: {
  player: RankingPlayer;
  ranked: boolean;
  compact: boolean;
  trailing?: ReactNode;
}) {
  const showStatus = player.availability !== "active";
  return (
    <>
      <PlayerAvatar player={player} size={compact ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate font-medium ${
              ranked ? "text-muted" : "text-ink"
            }`}
          >
            {player.name}
          </p>
          {ranked ? (
            <Badge tone="neutral" className="shrink-0 normal-case tracking-normal">
              Ranked
            </Badge>
          ) : null}
          {showStatus ? (
            <Badge
              tone={AVAILABILITY_TONE[player.availability]}
              className="shrink-0"
            >
              {availabilityLabel(player.availability)}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          <span className="font-semibold uppercase">{player.team}</span>
          {" · "}
          {player.opponent}
          {" · "}
          {player.gameDay} {player.gameTime}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">{trailing}</div>
    </>
  );
}

export function PlayerCard({
  player,
  ranked = false,
  disabled = false,
  onClick,
  trailing,
  compact = false,
}: {
  player: RankingPlayer;
  ranked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  compact?: boolean;
}) {
  const rowClass = `flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
    ranked
      ? "border-border/60 bg-surface opacity-80"
      : "border-transparent hover:border-border hover:bg-surface"
  }`;

  if (trailing) {
    return (
      <div className={rowClass}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || ranked}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed"
        >
          <PlayerCardBody
            player={player}
            ranked={ranked}
            compact={compact}
          />
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">{trailing}</div>
      </div>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || ranked}
        className={`${rowClass} disabled:cursor-not-allowed`}
      >
        <PlayerCardBody
          player={player}
          ranked={ranked}
          compact={compact}
          trailing={trailing}
        />
      </button>
    );
  }

  return (
    <div className={rowClass}>
      <PlayerCardBody
        player={player}
        ranked={ranked}
        compact={compact}
        trailing={trailing}
      />
    </div>
  );
}
