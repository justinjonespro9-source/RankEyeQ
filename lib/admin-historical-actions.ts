"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import {
  ensureHistoricalTestWeek,
  HistoricalTestError,
  runHistoricalTestStep,
} from "@/lib/admin/historical-test";
import { assertAdmin } from "@/lib/auth/session";
import { logAdminImpact } from "@/lib/log";

function revalidateTest(weekId?: string) {
  revalidatePath("/admin/test-week");
  revalidatePath("/admin");
  if (weekId) revalidatePath(`/admin/test-week?weekId=${weekId}`);
}

export async function createHistoricalTestWeekAction(formData: FormData) {
  const admin = await assertAdmin();
  const year = Number(formData.get("year"));
  const weekNumber = Number(formData.get("weekNumber"));
  try {
    const week = await ensureHistoricalTestWeek({ year, weekNumber });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "test_week.ensure",
      entityType: "Week",
      entityId: week.id,
      metadata: { year, weekNumber, isTest: true },
    });
    logAdminImpact("test_week.ensure", { weekId: week.id, year, weekNumber });
    revalidateTest(week.id);
    redirect(`/admin/test-week?weekId=${week.id}&notice=${encodeURIComponent("Historical test week ready")}`);
  } catch (error) {
    const message =
      error instanceof HistoricalTestError ? error.message : "Unable to create test week";
    redirect(`/admin/test-week?error=${encodeURIComponent(message)}`);
  }
}

export async function runHistoricalTestStepAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const step = String(formData.get("step") || "") as
    | "schedule"
    | "pool"
    | "contests"
    | "stats"
    | "finishes"
    | "seed_bots"
    | "grade";
  try {
    await runHistoricalTestStep({ weekId, step });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: `test_week.${step}`,
      entityType: "Week",
      entityId: weekId,
      metadata: { step, ok: true },
    });
    logAdminImpact(`test_week.${step}`, { weekId });
    revalidateTest(weekId);
    redirect(
      `/admin/test-week?weekId=${weekId}&notice=${encodeURIComponent(`Step ${step} complete`)}`,
    );
  } catch (error) {
    const message =
      error instanceof HistoricalTestError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Historical test step failed";
    redirect(
      `/admin/test-week?weekId=${weekId}&error=${encodeURIComponent(message)}`,
    );
  }
}
