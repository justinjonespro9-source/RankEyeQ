"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";

function SubmitButton({
  label,
  disabled,
  variant,
}: {
  label: string;
  disabled: boolean;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={disabled || pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ConfirmSubmit({
  action,
  submitLabel,
  impact,
  blockers = [],
  confirmPhrase,
  variant = "secondary",
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  impact: string;
  blockers?: string[];
  confirmPhrase?: string;
  variant?: "primary" | "secondary";
  children?: ReactNode;
}) {
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");
  const blocked = blockers.length > 0;
  const phraseOk = confirmPhrase
    ? typed.trim().toUpperCase() === confirmPhrase.toUpperCase()
    : true;
  const canSubmit = !blocked && checked && phraseOk;

  return (
    <form className="space-y-3 rounded-md border border-border bg-surface p-3" action={action}>
      {children}
      <p className="text-sm text-ink">{impact}</p>
      {blocked ? (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          Blocked:
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          disabled={blocked}
        />
        <span>I understand this high-impact action.</span>
      </label>
      {confirmPhrase ? (
        <label className="block text-sm">
          Type {confirmPhrase} to confirm
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2"
            disabled={blocked}
            autoComplete="off"
          />
        </label>
      ) : null}
      <SubmitButton label={submitLabel} disabled={!canSubmit} variant={variant} />
    </form>
  );
}
