import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { applyWaiverArtifactImport, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import { loadWaiverArtifactWeekView } from "@/lib/waivers/artifacts/queries";
import { createArtifactFixture, type ArtifactFixture } from "@/lib/waivers/__fixtures__/artifacts";

/** The UNVERIFIABLE kill switch: setting the gate back blocks every import while preview stays read-only. */
vi.mock("@/lib/waivers/artifacts/authority", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/waivers/artifacts/authority")>()),
  WAIVER_ARTIFACT_PUBLICATION_AUTHORITY: "UNVERIFIABLE",
}));

let f: ArtifactFixture;

beforeAll(async () => {
  f = await createArtifactFixture("gate");
});

afterAll(async () => {
  await f.cleanup();
});

describe("publication authority kill switch (UNVERIFIABLE)", () => {
  it("previews a valid artifact read-only but blocks the import and writes nothing", async () => {
    const request = f.request(f.build());
    const preview = await previewWaiverArtifactImport(request);
    expect(preview.verification.ok).toBe(true);
    expect(preview.authorityMode).toBe("UNVERIFIABLE");
    expect(preview.blockers.map((issue) => issue.code)).toEqual(["PUBLICATION_AUTHORITY_UNVERIFIABLE"]);
    expect(preview.importEnabled).toBe(false);

    await expect(
      applyWaiverArtifactImport({ ...request, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true }),
    ).rejects.toMatchObject({ code: "BLOCKED" });
    expect(await prisma.waiverCanonicalArtifact.count({ where: { weekId: f.weekId(5) } })).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { adminUserId: f.adminUserId } })).toBe(0);
    expect((await loadWaiverArtifactWeekView(f.weekId(5)))?.authorityMode).toBe("UNVERIFIABLE");
  });
});
