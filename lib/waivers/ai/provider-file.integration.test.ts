import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/waivers/ai/late-entry/[verificationId]/provider-file/route";
import { prisma } from "@/lib/db";
import { createWaiverFixture, type WaiverFixture } from "@/lib/waivers/__fixtures__/competition";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { verifyWaiverAiLateEntry } from "@/lib/waivers/ai/late-entry";
import { waiverAiProviderFilePath } from "@/lib/waivers/ai/queries";
import { parseAgainstContext } from "@/lib/waivers/ai/submissions";
import { sha256Utf8 } from "@/lib/waivers/ai/text";

/** The provider-file download route with a real local DB; only the session lookup is replaced. */
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/session", async () => {
  const { prisma: db } = await import("@/lib/db");
  const { canAccessAdmin } = await import("@/lib/admin/access");
  return {
    assertAdmin: async () => {
      const user = session.userId ? await db.user.findUnique({ where: { id: session.userId } }) : null;
      if (!user || !canAccessAdmin(user.role)) throw new Error("Admin access required");
      return { user, universalProfile: null };
    },
  };
});

const ORIGIN = "https://admin.rankeyeq.test";

let f: WaiverFixture;
let evidenceId: string;
let otherEvidenceId: string;
let withFile: string;
let withoutFile: string;
let member: string;
let demoted: string;
let fileBytes: Uint8Array;
let fileSha: string;

function get(verificationId: string, evidence: string | null, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const url = evidence === null ? `${ORIGIN}/api/admin/waivers/ai/late-entry/${verificationId}/provider-file` : `${ORIGIN}${waiverAiProviderFilePath(verificationId, evidence)}`;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ verificationId }) });
}

async function writeCounts() {
  const [verifications, approvals, submissions, audits] = await Promise.all([
    prisma.waiverAiLateEntryVerification.count(),
    prisma.waiverAiLateEntryApproval.count(),
    prisma.waiverSubmission.count(),
    prisma.adminAuditLog.count(),
  ]);
  return { verifications, approvals, submissions, audits };
}

beforeAll(async () => {
  f = await createWaiverFixture("pfile");
  const rb = await f.addPlayers("RB", 2);
  const week = await f.addWeek();
  const snapshot = await f.freezeSnapshot({ weekId: week.weekId, rows: rb.map((player) => ({ player })) });
  const contestId = (await f.createContest({ weekId: week.weekId, snapshotId: snapshot.id, position: "RB" })).id;
  const lockAt = new Date();
  await f.passLock(contestId, lockAt);
  const profile = (await f.addAiCompetitor("pfileai")).profileId;
  const other = (await f.addAiCompetitor("pfileother")).profileId;
  member = (await f.addParticipant("pfilemember")).userId;
  demoted = (await f.addAdmin("pfiledemoted")).userId;
  await prisma.user.update({ where: { id: demoted }, data: { role: "USER" } });

  const text = `1. ${rb[0].name}\n`;
  const record = async (universalProfileId: string) =>
    (
      await recordWaiverAiEvidence({
        adminUserId: f.adminUserId,
        contestId,
        universalProfileId,
        responseText: text,
        expectedResponseSha256: sha256Utf8(text),
        modelLabel: "Download model",
        statedSourceAt: null,
        evidenceSource: "CHAT_EXPORT",
        evidenceReference: "conversation.json",
        note: null,
      })
    ).evidenceId;
  evidenceId = await record(profile);
  otherEvidenceId = await record(other);
  await reviewWaiverAiEvidence({ adminUserId: f.adminUserId, evidenceId, expectedSequence: 0, status: "TEXT_CONFIRMED", note: "ok" });
  const context = (await loadWaiverAiContestContext(prisma, contestId))!;
  const pickIds = parseAgainstContext(context, text).picks.map((pick) => pick.rankableEntryId);
  const at = new Date(Math.floor((snapshot.frozenAt.getTime() + lockAt.getTime()) / 2));
  // BOM, CRLF and non-ASCII text: the download must return these bytes untouched.
  const json = `\uFEFF{"messages":[{"role":"assistant","created_at":"${at.toISOString()}","content":${JSON.stringify(text)}}],\r\n"title":"Wäivers — ✓"}`;
  fileBytes = new TextEncoder().encode(json);
  fileSha = sha256Utf8(json);
  const base = {
    adminUserId: f.adminUserId,
    evidenceId,
    sourceReference: "conversation.json",
    expectedPromptSha256: context.prompt.sha256,
    originalPrompt: { version: null, reference: null, text: null },
    confirmedRankableEntryIds: pickIds,
    attestation: "reviewed",
    originalPredictionAt: null,
  };
  withFile = (
    await verifyWaiverAiLateEntry({ ...base, expectedSequence: 0, basis: "PROVIDER_ARTIFACT", artifact: { name: "conversation (Week 5) ✓.json", bytes: fileBytes, expectedSha256: fileSha } })
  ).verificationId;
  withoutFile = (await verifyWaiverAiLateEntry({ ...base, expectedSequence: 1, basis: "OPERATOR_ATTESTED", artifact: null })).verificationId;
}, 120_000);

afterAll(async () => {
  session.userId = null;
  await f?.cleanup();
});

beforeEach(() => {
  session.userId = f.adminUserId;
});

describe("AI late-entry provider-file download", () => {
  it("returns the exact stored bytes to an admin, as a non-rendered, uncached attachment", async () => {
    const before = await writeCounts();
    const response = await get(withFile, evidenceId);
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.compare(Buffer.from(body), Buffer.from(fileBytes))).toBe(0);
    expect(body.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-length")).toBe(String(fileBytes.byteLength));
    expect(response.headers.get("x-rankeyeq-sha256")).toBe(fileSha);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/);
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe("conversation (Week 5) ✓.json");
    // Reading never writes.
    expect(await writeCounts()).toEqual(before);
  });

  it("refuses anyone who is not an admin, before reading the file", async () => {
    for (const userId of [null, member, demoted]) {
      session.userId = userId;
      const response = await get(withFile, evidenceId);
      expect(response.status).toBe(403);
      expect(response.headers.get("content-type")).toMatch(/application\/json/);
      const body = await response.text();
      expect(body).not.toContain("assistant");
    }
  });

  it("refuses cross-site requests even with an admin session", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const response = await get(withFile, evidenceId, { "sec-fetch-site": site });
      expect(response.status).toBe(403);
    }
    expect((await get(withFile, evidenceId, { "sec-fetch-site": "none" })).status).toBe(200);
  });

  it("validates the verification and evidence ids, and that the evidence owns the file", async () => {
    expect((await get(withFile, null)).status).toBe(400);
    expect((await get("not a valid id!", evidenceId)).status).toBe(400);
    expect((await get(withFile, otherEvidenceId)).status).toBe(404);
    expect((await get("unknown-verification", evidenceId)).status).toBe(404);
    expect((await get(withoutFile, evidenceId)).status).toBe(404);
  });
});
