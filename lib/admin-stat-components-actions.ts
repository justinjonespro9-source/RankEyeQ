"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import { assertAdmin } from "@/lib/auth/session";
import {
  commitStatComponentsImport,
  exportStatComponentsTemplate,
  previewStatComponentsImport,
} from "@/lib/nfl/manual/stat-components-import";

function revalidateStatImport(weekId: string) {
  revalidatePath("/admin/live-scoring");
  revalidatePath(`/admin/live-scoring?weekId=${weekId}`);
  revalidatePath("/admin/data");
  revalidatePath("/leaderboards/live");
  revalidatePath("/my-ranks");
}

export async function exportStatComponentsTemplateAction(input: {
  weekId: string;
}) {
  await assertAdmin();
  try {
    const result = await exportStatComponentsTemplate(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Template export failed",
    };
  }
}

export async function previewStatComponentsImportAction(input: {
  weekId: string;
  csvText: string;
  replaceProvisional?: boolean;
}) {
  await assertAdmin();
  try {
    const preview = await previewStatComponentsImport({
      weekId: input.weekId,
      csvText: input.csvText,
      replaceProvisional: input.replaceProvisional,
    });
    return { ok: true as const, preview };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Preview failed",
    };
  }
}

export async function commitStatComponentsImportAction(input: {
  weekId: string;
  csvText: string;
  previewToken: string;
  approved: boolean;
  sourceLabel: string;
  sourceUrl: string;
  observedAt: string;
  replaceProvisional?: boolean;
}) {
  const admin = await assertAdmin();
  try {
    const result = await commitStatComponentsImport({
      weekId: input.weekId,
      csvText: input.csvText,
      adminUserId: admin.user.id,
      previewToken: input.previewToken,
      approved: input.approved,
      sourceLabel: input.sourceLabel,
      sourceUrl: input.sourceUrl,
      observedAt: input.observedAt,
      replaceProvisional: input.replaceProvisional,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "live_scoring.stat_components_imported",
      entityType: "Week",
      entityId: input.weekId,
      metadata: {
        ...result,
        sourceLabel: input.sourceLabel,
        sourceUrl: input.sourceUrl,
        observedAt: input.observedAt,
        replaceProvisional: Boolean(input.replaceProvisional),
      },
    });
    revalidateStatImport(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Commit failed",
    };
  }
}
