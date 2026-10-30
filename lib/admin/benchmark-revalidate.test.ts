import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

describe("revalidateBenchmarkCapture", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
  });

  it("always refreshes admin capture grids", async () => {
    const { revalidateBenchmarkCapture } = await import(
      "@/lib/admin/benchmark-revalidate"
    );
    revalidateBenchmarkCapture({ weekId: "week_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/benchmarks");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/creators");
    expect(revalidatePath).toHaveBeenCalledWith(
      "/admin/benchmarks?weekId=week_1",
    );
    expect(revalidatePath).not.toHaveBeenCalledWith("/leaderboards");
    expect(revalidatePath).not.toHaveBeenCalledWith("/consensus");
    expect(revalidatePath).not.toHaveBeenCalledWith("/admin");
  });

  it("invalidates public caches only for official locks", async () => {
    const { revalidateBenchmarkCapture } = await import(
      "@/lib/admin/benchmark-revalidate"
    );
    revalidateBenchmarkCapture({
      weekId: "week_1",
      profileId: "p1",
      contestId: "c1",
      includeBoard: true,
      invalidatePublic: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/leaderboards");
    expect(revalidatePath).toHaveBeenCalledWith("/consensus");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/benchmarks/p1/c1");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/creators/board/p1/c1");
  });

  it("remounts board without public invalidation for late-only captures", async () => {
    const { revalidateBenchmarkCapture } = await import(
      "@/lib/admin/benchmark-revalidate"
    );
    revalidateBenchmarkCapture({
      profileId: "p1",
      contestId: "c1",
      includeBoard: true,
      invalidatePublic: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/benchmarks/p1/c1");
    expect(revalidatePath).not.toHaveBeenCalledWith("/leaderboards");
  });
});
