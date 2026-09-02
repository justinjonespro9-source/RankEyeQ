import type { Metadata } from "next";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getSmokeDiagnostics } from "@/lib/admin/smoke";
import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Diagnostics · Admin",
  "Production smoke checks for RankEyeQ. No secrets are displayed.",
);

export const dynamic = "force-dynamic";

export default async function AdminDiagnosticsPage() {
  const smoke = await getSmokeDiagnostics();

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/diagnostics" />
      <SectionHeading
        eyebrow="Launch"
        title="Production smoke checks"
        description="Connectivity, auth configuration, active week, provider, pools, AI coverage, and scoring versions. Secrets are never shown."
      />

      <div className="mb-6">
        <Badge tone={smoke.ok ? "success" : "warning"}>
          {smoke.ok ? "All checks passed" : "Needs attention"}
        </Badge>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
        {smoke.checks.map((check) => (
          <li key={check.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-medium text-ink">{check.key.replaceAll("_", " ")}</p>
              <p className="text-sm text-muted">{check.detail}</p>
            </div>
            <Badge tone={check.ok ? "success" : "warning"}>
              {check.ok ? "OK" : "Fail"}
            </Badge>
          </li>
        ))}
      </ul>

      <section className="mt-8 rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="font-display text-lg font-semibold text-ink">Env summary</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>Database URL set: {smoke.envSummary.hasDatabaseUrl ? "yes" : "no"}</div>
          <div>Auth secret set: {smoke.envSummary.hasAuthSecret ? "yes" : "no"}</div>
          <div>Auth URL set: {smoke.envSummary.hasAuthUrl ? "yes" : "no"}</div>
          <div>Email provider: {smoke.envSummary.emailProvider}</div>
          <div>Google OAuth: {smoke.envSummary.googleOAuth ? "on" : "off"}</div>
          <div>NFL provider: {smoke.envSummary.nflProvider}</div>
          <div>SportsDataIO key: {smoke.envSummary.hasSportsDataKey ? "set" : "not set"}</div>
        </dl>
      </section>
    </Container>
  );
}
