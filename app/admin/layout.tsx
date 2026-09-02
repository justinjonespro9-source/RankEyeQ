import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Admin",
  ...NO_INDEX,
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return children;
}
