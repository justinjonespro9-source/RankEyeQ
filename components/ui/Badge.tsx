import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface text-muted border-border",
  success: "bg-accent-soft text-accent border-accent/20",
  warning: "bg-warning-soft text-warning border-warning/20",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
