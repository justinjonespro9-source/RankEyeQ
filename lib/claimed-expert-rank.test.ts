import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState: { ctx: unknown } = { ctx: null };

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: async () => authState.ctx,
}));

const saveSubmissionPicks = vi.fn();
vi.mock("@/lib/submissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/submissions")>();
  return {
    ...actual,
    saveSubmissionPicks: (...args: unknown[]) => saveSubmissionPicks(...args),
    submitRanking: (...args: unknown[]) => saveSubmissionPicks(...args),
  };
});

import {
  CLAIMED_EXPERT_RANK_MESSAGE,
  ClaimedExpertRankNotice,
} from "@/components/rank/ClaimedExpertRankNotice";
import { shouldShowClaimedExpertRankState } from "@/lib/auth/participation";
import {
  saveDraftAction,
  submitRankingsAction,
} from "@/lib/submission-actions";

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("claimed Expert /rank state", () => {
  beforeEach(() => {
    saveSubmissionPicks.mockReset();
  });

  it("only BENCHMARK owners get the tracked-Expert state", () => {
    expect(shouldShowClaimedExpertRankState("BENCHMARK")).toBe(true);
    expect(shouldShowClaimedExpertRankState("HUMAN")).toBe(false);
    expect(shouldShowClaimedExpertRankState("CREATOR")).toBe(false);
    expect(shouldShowClaimedExpertRankState(null)).toBe(false);
  });

  it("renders the message and a View My Profile link, with no ranking form", () => {
    const html = renderToStaticMarkup(
      createElement(ClaimedExpertRankNotice, { username: "justin_boone" }),
    );
    expect(html).toContain(CLAIMED_EXPERT_RANK_MESSAGE);
    expect(html).toContain('href="/profile/justin_boone"');
    expect(html).toContain("View My Profile");
    expect(html).not.toMatch(/<form|type="submit"/);
  });

  it("both /rank pages short-circuit before any submission lookup or draft creation", () => {
    const hub = read("app/rank/page.tsx");
    expect(hub).toContain("shouldShowClaimedExpertRankState");
    expect(hub.indexOf("ClaimedExpertRankNotice username")).toBeLessThan(
      hub.indexOf("getHomepageData(activeProfile"),
    );

    const position = read("app/rank/[position]/page.tsx");
    const guard = position.indexOf("<ClaimedExpertRankNotice");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(position.indexOf("await getOrCreateDraftSubmission"));
    expect(guard).toBeLessThan(position.indexOf("<RankingWorkspace"));
  });

  it("server actions reject a claimed Expert even if the UI is bypassed", async () => {
    authState.ctx = {
      user: { id: "u1" },
      universalProfile: {
        id: "boone-profile",
        username: "justin_boone",
        profileType: "BENCHMARK",
        status: "ACTIVE",
      },
    };
    const input = {
      contestId: "c1",
      rankedEntryIds: ["p1"],
      position: "WR",
    };
    const draft = await saveDraftAction(input);
    const submit = await submitRankingsAction(input);
    expect(draft).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(submit).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(saveSubmissionPicks).not.toHaveBeenCalled();
  });
});
