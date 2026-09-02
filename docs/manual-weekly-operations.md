# Manual weekly NFL operations

> **Brand note:** RankEYEQ is the public product brand. Some internal technical identifiers retain the historical RankIQ name intentionally.

RankEYEQ can run a full NFL season with **`NFL_DATA_PROVIDER=manual`** — no SportsDataIO or other paid sports-data API.

Schedule, weekly eligibility, and final fantasy points are operator-entered. Auth, scoring, Thursday individual locks, Sunday 10:00 AM CT full lock, consensus/reveal, AI/experts, and creator entitlements are unchanged.

## Environment

```bash
NFL_DATA_PROVIDER=manual
```

Do **not** set `SPORTSDATAIO_API_KEY` unless you switch to `sportsdataio`. Diagnostics and Finalize Week treat manual mode as a normal production configuration.

See `docs/env.md` and `.env.example`.

## Surfaces

| Surface | Purpose |
| --- | --- |
| `/admin` | Command center + Manual weekly ops shortcuts |
| `/admin/data` | Same paste tools + finalize/grade |
| `/admin/players` | Master player / defense directory |
| `/leaderboards/live` | Unofficial standings (manual paste only; no auto feed) |

## Recommended weekly workflow

### Tuesday

1. **Create/select week** on `/admin` (timing auto-fills Tue open / Sun 10 AM CT lock / noon public).
2. **Paste weekly schedule** — `Away | Home | Kickoff` (e.g. `GB | MIN | 2026-09-13 12:00 CT`).
3. **Copy Previous Week Pools** — retains players and manual exclusions; **does not** carry opponent or kickoff.
4. **Paste/reconcile pools** — all-position or per-position (QB/RB/WR/TE). Confirm creating new master players when preview shows unmatched names.
5. **Build DEF Pool from Schedule**.
6. **Audit All Pools** — every position should show READY (team, opponent, kickoff, no free agents, no missing games).
7. **Open Contests (if READY)** — override requires confirmation + audit log.
8. Collect **AI / expert** rankings as usual.

### Thursday

9. Verify early-player (individual) locks.
10. Optional: **Save provisional (live)** fantasy points for LIVE — Unofficial EYEQ.

### Sunday

11. Verify full lock / reveal at 10:00 AM America/Chicago.
12. Optional: more provisional updates during games.

### Monday / Tuesday

13. **Paste final fantasy points** (`Name | Points` or `Name | Position | Points`).
14. **Calculate Actual Finishes** (competition ranks / ties).
15. **Grade All**.
16. Confirm **All final NFL results have been entered and verified**.
17. **Finalize Week** (no SportsDataIO credentials required).
18. Archive when ready.

## Paste formats

### Schedule

```
GB | MIN | 2026-09-13 12:00 CT
CHI | DET | 2026-09-13 12:00 CT
```

Comma- or tab-delimited rows also work. Validates duplicate teams/games, self-matchups, and kickoffs.

### Player pools

All positions:

```
Jahmyr Gibbs | RB | DET | GB | 2026-09-13 12:00 CT
```

Position-scoped (select RB first):

```
Jahmyr Gibbs | DET | GB | 2026-09-13 12:00 CT
```

Ambiguous names never auto-resolve. Duplicate rows and position mismatches block commit until fixed. New masters require explicit confirmation.

### Final / provisional fantasy points

```
Jahmyr Gibbs | 27.4
Bijan Robinson | 0.0
```

Or whole week:

```
Jahmyr Gibbs | RB | 27.4
```

Explicit `0.0` is a real score. Rows omitted stay missing (distinct from zero). Provisional pastes never overwrite final official scores.

## Eligibility rules (manual mode)

A player is eligible for a contest only when:

- Position matches the contest
- Team is present (not FA / free agent / TBD)
- Team has a game that week
- Opponent and kickoff are known
- Master record is active
- Contest entry is not manually excluded

Presence in the master directory alone is never enough.

## Finalize Week (manual)

Requires:

- All five contest pools READY
- Official submissions locked (week timing / status)
- Final fantasy points entered
- Actual ranks calculated for Top-N depth
- No provisional-only stat rows remaining
- Explicit verified-results confirmation (audit logged)

Does **not** require SportsDataIO credentials or provider game-FINAL flags.

## Still repetitive (by design)

- Pasting schedule and position pools each week
- Reconciling byes, trades, and injury exclusions
- Pasting final fantasy points (or provisional in-game updates)
- Confirming ambiguous name matches
- Collecting AI/expert boards (unchanged)

Raw-stat → fantasy-point conversion paste is optional and not required for V1; direct fantasy-point paste is the fast path.
