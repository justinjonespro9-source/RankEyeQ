import Link from "next/link";

const TABS = [
  { key: "rankings", label: "Rankings", href: "/admin/ai" },
  { key: "waivers", label: "Waivers", href: "/admin/ai?discipline=waivers" },
] as const;

export function AiDisciplineTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="AI discipline" className="mb-6 flex flex-wrap gap-2">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab.key === current ? "bg-ink text-off-white" : "border border-border bg-surface-elevated text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
