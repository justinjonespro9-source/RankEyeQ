import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

export const metadata: Metadata = {
  title: "Command Center · Admin",
  description:
    "Organize RankEyeQ people, sources, and competitor tools without merging underlying admin pages.",
};

export const dynamic = "force-dynamic";

type HubCard = {
  href: string;
  title: string;
  description: string;
};

const PEOPLE: HubCard[] = [
  {
    href: "/admin/users",
    title: "Users",
    description: "Manage RankEyeQ accounts and profiles.",
  },
  {
    href: "/admin/experts",
    title: "Experts",
    description: "Manage expert source identities.",
  },
  {
    href: "/admin/creators",
    title: "Creators",
    description: "Creator identities, verification and entitlements.",
  },
  {
    href: "/admin/creators/verification",
    title: "Creator Verify",
    description: "Review and verify creator profile requests.",
  },
];

const SOURCES: HubCard[] = [
  {
    href: "/admin/benchmarks",
    title: "Benchmarks",
    description: "Manage benchmark/source ranking capture.",
  },
  {
    href: "/admin/ai",
    title: "AI",
    description: "Manage AI ranking boards.",
  },
];

const COMPETITORS: HubCard[] = [
  {
    href: "/admin/competitors/new",
    title: "Add Competitor",
    description: "Create a competitor profile.",
  },
  {
    href: "/admin/competitors/live",
    title: "Competitor Live",
    description: "Live competitor QA/management.",
  },
];

function HubSection({
  title,
  cards,
}: {
  title: string;
  cards: HubCard[];
}) {
  return (
    <section className="mb-8">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-border bg-surface-elevated p-4 transition-colors hover:border-ink/30"
          >
            <p className="font-display text-base font-semibold text-ink">
              {card.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function AdminCommandCenterPage() {
  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav />
      <SectionHeading
        eyebrow="Identities & sources"
        title="Command Center"
        description="Organize people, boards, and competitor tools. Specialized admin pages stay separate — this hub is discovery only."
      />

      <HubSection title="People / Identities" cards={PEOPLE} />
      <HubSection title="Sources / Boards" cards={SOURCES} />
      <HubSection title="Competitors" cards={COMPETITORS} />

      <p className="text-sm text-muted">
        Creator entitlements:{" "}
        <Link
          href="/admin/creators/entitlements"
          className="font-medium text-ink underline-offset-2 hover:underline"
        >
          /admin/creators/entitlements
        </Link>
      </p>
    </Container>
  );
}
