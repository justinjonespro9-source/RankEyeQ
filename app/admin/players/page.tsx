import type { Metadata } from "next";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  createMasterPlayerAction,
  updateMasterPlayerAction,
} from "@/lib/admin-manual-actions";
import { searchMasterPlayers } from "@/lib/nfl/manual/players";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Master player directory",
  description: "Maintain the RankEyeQ NFL player and defense master list.",
};

export const dynamic = "force-dynamic";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export default async function AdminPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    position?: string;
    active?: string;
    missingTeam?: string;
    duplicates?: string;
    team?: string;
  }>;
}) {
  const params = await searchParams;
  const position = (
    POSITIONS.includes(params.position as ContestPosition)
      ? params.position
      : "ALL"
  ) as ContestPosition | "ALL";
  const active = (
    ["ALL", "ACTIVE", "INACTIVE"].includes(params.active ?? "")
      ? params.active
      : "ALL"
  ) as "ALL" | "ACTIVE" | "INACTIVE";

  const rows = await searchMasterPlayers({
    query: params.q,
    position,
    team: params.team,
    active,
    missingTeam: params.missingTeam === "1",
    possibleDuplicates: params.duplicates === "1",
  });

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/players" />
      <SectionHeading
        eyebrow="Directory"
        title="Master players & defenses"
        description="Persistent identities reused across weeks. Enroll players in the active season roster, then activate them per week on Weekly Pools. Opponent and kickoff are week-specific."
      />

      <form className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-elevated p-4">
        <label className="text-sm">
          <span className="text-muted">Search</span>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            className="mt-1 block w-48 rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Position</span>
          <select
            name="position"
            defaultValue={position}
            className="mt-1 block rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="ALL">All</option>
            {POSITIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Team</span>
          <input
            name="team"
            defaultValue={params.team ?? ""}
            placeholder="DET"
            className="mt-1 block w-24 rounded-md border border-border bg-surface px-3 py-2 uppercase"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Active</span>
          <select
            name="active"
            defaultValue={active}
            className="mt-1 block rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="missingTeam"
            value="1"
            defaultChecked={params.missingTeam === "1"}
          />
          Missing team
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="duplicates"
            value="1"
            defaultChecked={params.duplicates === "1"}
          />
          Possible duplicates
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Filter
        </Button>
      </form>

      <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Add master player
        </h2>
        <form
          action={createMasterPlayerAction}
          className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="text-sm">
            <span className="text-muted">Name</span>
            <input
              name="name"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Position</span>
            <select
              name="position"
              defaultValue="RB"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {POSITIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Team</span>
            <input
              name="team"
              required
              placeholder="DET"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 uppercase"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">Headshot URL (optional)</span>
            <input
              name="headshotUrl"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="text-sm sm:col-span-2 lg:col-span-3">
            <span className="text-muted">Admin notes</span>
            <input
              name="adminNotes"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <div>
            <Button type="submit" size="sm">
              Create
            </Button>
          </div>
        </form>
      </section>

      <p className="mb-3 text-sm text-muted">{rows.length} players shown</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Pos</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Headshot</th>
              <th className="px-3 py-2">External ID</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2">Save</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2" colSpan={8}>
                  <form
                    action={updateMasterPlayerAction}
                    className="grid grid-cols-[minmax(8rem,1.4fr)_4rem_4.5rem_5rem_minmax(6rem,1fr)_minmax(6rem,1fr)_minmax(6rem,1fr)_auto] items-center gap-2"
                  >
                    <input type="hidden" name="id" value={row.id} />
                    <input
                      name="name"
                      defaultValue={row.name}
                      className="rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <select
                      name="position"
                      defaultValue={row.position}
                      className="rounded-md border border-border bg-surface px-2 py-1"
                    >
                      {POSITIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                    <input
                      name="team"
                      defaultValue={row.team}
                      className="rounded-md border border-border bg-surface px-2 py-1 uppercase"
                    />
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        name="active"
                        value="1"
                        defaultChecked={row.active}
                      />
                      Active
                    </label>
                    <input
                      name="headshotUrl"
                      defaultValue={row.headshotUrl ?? ""}
                      placeholder="URL"
                      className="rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <span className="truncate font-mono text-xs text-muted" title={row.externalId}>
                      {row.provider}/{row.externalId}
                    </span>
                    <input
                      name="adminNotes"
                      defaultValue={row.adminNotes ?? ""}
                      className="rounded-md border border-border bg-surface px-2 py-1"
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      Save
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}
