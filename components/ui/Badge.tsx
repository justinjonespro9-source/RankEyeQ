import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "accent" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface text-muted border-border",
  /** Semantic status — distinct from brand teal */
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/20",
  accent: "bg-accent-soft text-ink border-accent/30",
  danger: "bg-danger-soft text-danger border-danger/25",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center rounded border px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
