import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Command Center" },
  { href: "/admin/ai", label: "AI Rankings" },
  { href: "/admin/benchmarks", label: "Benchmarks" },
  { href: "/admin/experts", label: "Experts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/creators", label: "Creators" },
  { href: "/admin/test-week", label: "Test Week" },
  { href: "/admin/preview", label: "Test Preview" },
  { href: "/admin/diagnostics", label: "Diagnostics" },
  { href: "/admin/ops", label: "Weekly Ops" },
  { href: "/admin/seasons", label: "Seasons & Weeks" },
  { href: "/admin/data", label: "NFL Data" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/weekly-pools", label: "Weekly Pools" },
  { href: "/admin/weekly-exceptions", label: "Exceptions" },
  { href: "/admin/contests", label: "Contests" },
  { href: "/admin/scoring-lab", label: "Scoring Lab" },
  { href: "/admin/scoring", label: "Scoring Versions" },
  { href: "/legal", label: "Legal" },
];

export function AdminNav({ current }: { current?: string }) {
  return (
    <nav className="mb-8 flex flex-wrap gap-2" aria-label="Admin">
      {LINKS.map((link) => {
        const active = current === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              active
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink hover:border-ink/30"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
