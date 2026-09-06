import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { ProfileBoardAccessSummary } from "@/lib/public-board";

/**
 * Current-week board strip — respects reveal/lock privacy via access summaries.
 * Never links into private ballots as if they were public receipts.
 */
export function CurrentWeekBoardsSection({
  username,
  weekBoards,
  isOwner = false,
}: {
  username: string;
  weekBoards: ProfileBoardAccessSummary[];
  isOwner?: boolean;
}) {
  if (weekBoards.length === 0) return null;

  const weekNumber = weekBoards[0]?.weekNumber;
  const anyLocked = weekBoards.some((board) => !board.allowed);
  const anyPublic = weekBoards.some((board) => board.allowed);

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Week {weekNumber} boards
      </h2>
      <p className="mt-1 text-sm text-muted">
        {anyLocked && !anyPublic
          ? isOwner
            ? "Your submitted rankings stay private until the Sunday reveal window."
            : "Rankings submitted. Boards unlock after the Sunday reveal (or when the week is public)."
          : anyLocked
            ? "Some boards are public; others remain locked until reveal or noon CT release."
            : "Submitted boards for this week."}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {weekBoards.map((board) => {
          const href = `/profile/${username}/rankings/${board.weekNumber}/${board.position.toLowerCase()}`;
          const content = (
            <>
              <span className="font-medium text-ink">{board.position}</span>
              {board.gatedPremium ? (
                <Badge tone="warning">Premium before noon</Badge>
              ) : board.allowed ? (
                <Badge tone="success">View board</Badge>
              ) : (
                <Badge tone="neutral">
                  {isOwner ? "Private until reveal" : "Locked"}
                </Badge>
              )}
            </>
          );

          return (
            <li key={board.position}>
              {board.allowed ? (
                <Link
                  href={href}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:border-ink/30"
                >
                  {content}
                </Link>
              ) : isOwner ? (
                <Link
                  href={`/rank/${board.position.toLowerCase()}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:border-ink/30"
                  title="Owners can manage rankings from the rank page"
                >
                  {content}
                </Link>
              ) : (
                <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
