"use server";

/**
 * Official Boards Admin server actions. The complete admin write surface:
 * canonical FINAL capture and WeeklyContent moderation. There is deliberately
 * no action to publish, update, unpublish, edit or delete board versions,
 * change SubmissionAuthority or change picks.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  captureMissingOfficialBoardFinals,
  restoreWeeklyContent,
  suppressWeeklyContent,
} from "@/lib/admin/official-boards";
import { assertAdmin } from "@/lib/auth/session";

const PAGE = "/admin/official-boards";

function pageHref(weekId: string, params: Record<string, string>) {
  const search = new URLSearchParams({ weekId, ...params });
  return `${PAGE}?${search.toString()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 200) : "Action failed.";
}

export async function captureMissingOfficialBoardFinalsAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  let target: string;
  try {
    const result = await captureMissingOfficialBoardFinals({
      adminUserId: admin.user.id,
      weekId,
    });
    target = pageHref(weekId, {
      notice: `Captured ${result.created} FINAL receipt(s); ${result.existing} already existed.`,
    });
  } catch (error) {
    target = pageHref(weekId, { error: errorMessage(error) });
  }
  revalidatePath(PAGE);
  revalidatePath("/admin/ops");
  redirect(target);
}

export async function suppressWeeklyContentAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  let target: string;
  try {
    await suppressWeeklyContent({
      adminUserId: admin.user.id,
      id: String(formData.get("id") || ""),
      reason: String(formData.get("reason") || ""),
    });
    target = pageHref(weekId, { notice: "Link hidden from public display." });
  } catch (error) {
    target = pageHref(weekId, { error: errorMessage(error) });
  }
  revalidatePath(PAGE);
  revalidatePath("/profile", "layout");
  redirect(target);
}

export async function restoreWeeklyContentAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  let target: string;
  try {
    await restoreWeeklyContent({
      adminUserId: admin.user.id,
      id: String(formData.get("id") || ""),
    });
    target = pageHref(weekId, { notice: "Link restored to public display." });
  } catch (error) {
    target = pageHref(weekId, { error: errorMessage(error) });
  }
  revalidatePath(PAGE);
  revalidatePath("/profile", "layout");
  redirect(target);
}
