import { PlayerAvatar } from "@/components/rank/PlayerAvatar";
import { BrandWordmark } from "@/components/brand/BrandWordmark";
import {
  HERO_DEMO_RB_POOL,
  HERO_DEMO_RB_RANKED,
} from "@/components/home/hero-demo-data";

const RANKED_IDS = new Set(HERO_DEMO_RB_RANKED.map((p) => p.id));
const PODIUM = 3;

/**
 * Visual-only mobile Rank builder screen — mirrors RankingWorkspace mobile
 * (sticky progress + Your RB Top 10 board + pool list). No interactivity.
 */
export function HeroPhoneRankScreen() {
  return (
    <div className="flex h-full flex-col bg-background text-[11px] leading-tight">
      <header className="flex items-center justify-between border-b border-border bg-off-white px-3 py-2">
        <BrandWordmark size="sm" variant="light" className="scale-90 origin-left" />
        <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-ink">
          RB
        </span>
      </header>

      <div className="border-b border-border bg-surface/95 px-3 py-1.5">
        <p className="text-[11px] font-medium text-ink">
          10 / 10 selected · Your RB Top 10
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-2 p-2">
          <section className="overflow-hidden rounded-md border border-accent/20 bg-surface-elevated">
            <div className="border-b border-border bg-accent-soft/20 px-2.5 py-2">
              <p className="font-display text-[13px] font-semibold text-ink">
                Your RB Top 10
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                Drag or use move buttons to reorder.
              </p>
            </div>

            <div className="space-y-1.5 p-2">
              <div className="rounded border border-accent/25 bg-accent-soft/30 px-2 py-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-accent-ink">
                  Podium picks · slots 1–3
                </p>
              </div>

              <ol className="space-y-1.5">
                {HERO_DEMO_RB_RANKED.map((player, index) => {
                  const rank = index + 1;
                  const podium = index < PODIUM;
                  return (
                    <li key={player.id}>
                      {index === PODIUM ? (
                        <p className="mb-1 px-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                          Field picks · slots 4–10
                        </p>
                      ) : null}
                      <div
                        className={`flex min-h-8 items-center gap-1.5 rounded border px-1.5 py-0.5 ${
                          podium
                            ? "border-accent/35 bg-accent-soft/25"
                            : "border-border bg-surface"
                        }`}
                      >
                        <span className="font-display w-3.5 shrink-0 text-center text-[10px] font-semibold tabular-nums text-accent-ink">
                          {rank}
                        </span>
                        <span className="scale-90 origin-left">
                          <PlayerAvatar player={player} size="sm" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-medium text-ink">
                            {player.name}
                          </span>
                          <span className="block truncate text-[8px] text-muted">
                            {player.team} · {player.opponent}
                          </span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>

          <section className="overflow-hidden rounded-md border border-border bg-surface-elevated">
            <div className="border-b border-border bg-surface px-2.5 py-1.5">
              <p className="font-display text-[12px] font-semibold text-ink">
                Player pool
              </p>
            </div>
            <ul className="divide-y divide-border">
              {HERO_DEMO_RB_POOL.slice(8, 13).map((player) => {
                const ranked = RANKED_IDS.has(player.id);
                return (
                  <li
                    key={player.id}
                    className="flex items-center gap-2 px-2.5 py-1.5"
                  >
                    <PlayerAvatar player={player} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[11px] font-medium ${
                          ranked ? "text-muted" : "text-ink"
                        }`}
                      >
                        {player.name}
                      </span>
                      <span className="block truncate text-[9px] text-muted">
                        {player.team} · {player.opponent}
                      </span>
                    </span>
                    {ranked ? (
                      <span className="rounded border border-border bg-surface px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide text-muted">
                        Ranked
                      </span>
                    ) : (
                      <span className="rounded-md bg-accent px-1.5 py-0.5 text-[9px] font-semibold text-ink">
                        Add
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
