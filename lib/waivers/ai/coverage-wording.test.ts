import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WaiverAiWeekView } from "@/lib/waivers/ai/queries";

/** Admin → AI → Waivers coverage page copy for open, locked and graded contests. */

const loadWaiverAiAdminWeeks = vi.fn();
const loadWaiverAiWeekView = vi.fn();
vi.mock("@/lib/waivers/ai/queries", () => ({
  loadWaiverAiAdminWeeks: () => loadWaiverAiAdminWeeks(),
  loadWaiverAiWeekView: (...args: unknown[]) => loadWaiverAiWeekView(...args),
}));

const { WaiversAiWorkflow } = await import("@/app/admin/ai/_waivers/WaiversAiWorkflow");

const LOCKED_PROMPT = "WaiverEyeQ prediction — locked QB prompt";
const OPEN_PROMPT = "WaiverEyeQ prediction — open WR prompt";

function view(gradingStarted: boolean): WaiverAiWeekView {
  const contest = (contestId: string, position: "QB" | "WR", phase: "OPEN" | "LOCKED", promptText: string | null) => ({
    contestId,
    position,
    locksAt: new Date("2026-10-06T03:00:00Z"),
    phase,
    snapshot: { id: "snap", version: 1, entriesFingerprint: "f".repeat(64) },
    poolSize: 10,
    availableSlots: 3,
    promptVersion: "WAIVEREYEQ_AI_V1",
    promptSha256: "a".repeat(64),
    promptText,
  });
  return {
    week: { id: "w5", label: "Week 5", seasonYear: 2026, weekNumber: 5, isTest: false },
    now: new Date("2026-10-10T15:00:00Z"),
    contests: [contest("qb", "QB", "LOCKED", null), contest("wr", "WR", "OPEN", OPEN_PROMPT)],
    competitors: [
      { id: "claude", username: "claude", displayName: "Claude", active: true },
      { id: "old", username: "old-bot", displayName: "Old Bot", active: false },
    ],
    cells: {
      claude: {
        QB: { status: "LOCKED", revisionNumber: 1, callCount: 3, evidenceCount: 0, lateEntered: false, overridden: true },
        WR: { status: "MISSING", revisionNumber: null, callCount: null, evidenceCount: 0, lateEntered: false, overridden: false },
      },
      old: {
        QB: { status: "LOCKED", revisionNumber: 1, callCount: 1, evidenceCount: 0, lateEntered: false, overridden: false },
        WR: { status: "MISSING", revisionNumber: null, callCount: null, evidenceCount: 0, lateEntered: false, overridden: false },
      },
    },
    totals: { expected: 2, submitted: 0, locked: 1, evidenceOnly: 0, missing: 1 },
    gradingStarted,
  };
}

async function render(gradingStarted: boolean) {
  loadWaiverAiWeekView.mockResolvedValueOnce(view(gradingStarted));
  const html = renderToStaticMarkup(await WaiversAiWorkflow({ weekId: "w5" }));
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

beforeEach(() => {
  loadWaiverAiAdminWeeks.mockReset();
  loadWaiverAiWeekView.mockReset();
  loadWaiverAiAdminWeeks.mockResolvedValue([{ id: "w5", label: "Week 5", seasonYear: 2026, isTest: false }]);
});

describe("AI WaiverEyeQ coverage page wording", () => {
  it("states the current submission rules and drops the obsolete lock statements", async () => {
    const text = await render(false);
    expect(text).toContain("Normal AI submissions close when each contest locks.");
    expect(text).toContain("After the lock, an admin can still enter a missing AI board from its board page by checking “Allow late AI submission”.");
    expect(text).toContain("A late submission never replaces a board the AI already has.");
    expect(text).toContain("Late submissions close once grading begins for the week.");
    expect(text).toContain("Late submissions are marked “Admin override” here and in the board history.");
    expect(text).toContain("Each AI board page keeps the frozen prompt available to admins, including after the lock.");
    expect(text).toContain("Locked: normal AI submissions are closed. Open an AI's board page to view this prompt or make a late AI submission.");
    expect(text).toContain("after the lock, open any AI's board page to view or copy its prompt.");
    expect(text).not.toMatch(/no new AI boards can be submitted/i);
    expect(text).not.toMatch(/copyable only while/i);
    expect(text).not.toContain("Grading has begun");
  });

  it("says late submissions are closed once the week has been graded", async () => {
    const text = await render(true);
    expect(text).toContain("Grading has begun for this week, so they are closed.");
    expect(text).toContain("Locked and grading has begun: AI submissions are closed. The prompt stays available on each AI board page.");
    expect(text).not.toContain("make a late AI submission");
  });

  it("labels overrides and uncounted inactive AIs, and shows prompt text only for open contests", async () => {
    loadWaiverAiWeekView.mockResolvedValueOnce(view(false));
    const html = renderToStaticMarkup(await WaiversAiWorkflow({ weekId: "w5" }));
    expect(html).toContain("Admin override");
    expect(html).toContain("(inactive · not counted)");
    expect(html).toContain('href="/admin/waivers/ai/old/qb"');
    expect(html).toContain(OPEN_PROMPT);
    expect(html).not.toContain(LOCKED_PROMPT);
    expect(html.match(/Copy Prompt/g)).toHaveLength(1);
  });
});
