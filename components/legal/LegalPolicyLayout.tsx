import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { NO_WAGERING_DISCLAIMER } from "@/lib/company";
import { formatPolicyLastUpdated } from "@/lib/legal/policies";

export function LegalPolicyLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Legal
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted">
          Last updated: {formatPolicyLastUpdated(lastUpdated)}
        </p>
        <p className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
          {NO_WAGERING_DISCLAIMER}
        </p>
        <article className="prose-policy mt-8 space-y-8 text-sm leading-relaxed text-muted">
          {children}
        </article>
        <p className="mt-10 text-sm text-muted">
          <Link href="/legal" className="text-accent hover:underline">
            All policies
          </Link>
        </p>
      </div>
    </Container>
  );
}

export function LegalPolicySection({
  heading,
  body,
}: {
  heading: string;
  body: string;
}) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink">{heading}</h2>
      <p className="mt-2">{body}</p>
    </section>
  );
}

export function parsePolicyMarkdown(content: string) {
  const sections: { heading: string; body: string }[] = [];
  const parts = content.split(/^## /m).filter(Boolean);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const heading = newline === -1 ? part.trim() : part.slice(0, newline).trim();
    const body =
      newline === -1 ? "" : part.slice(newline + 1).trim();
    if (heading) sections.push({ heading, body });
  }
  return sections;
}
