import type { WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";
import { WAIVER_SLOT_LABELS } from "@/lib/waivers/constants";

/** Exact ordered picks and every validation error of a strict WaiverEyeQ parse. */
export function WaiverAiParsePreview({ parse }: { parse: WaiverAiParseResult }) {
  const pickLines = parse.lines.filter((line) => line.kind === "PICK" || line.kind === "UNPARSEABLE" || line.kind === "NO_CALLS");
  return (
    <div className="space-y-3">
      {parse.ok ? (
        <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
          {parse.noCalls
            ? "Valid NO CALLS response — an explicit zero-call board."
            : `Valid response · ${parse.picks.length} pick${parse.picks.length === 1 ? "" : "s"} of up to ${parse.availableSlots}.`}
        </p>
      ) : (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          <p className="font-medium">Response rejected — nothing can be saved from it ({parse.issues.length} error{parse.issues.length === 1 ? "" : "s"})</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {parse.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <span className="font-mono text-xs">{issue.code}</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pickLines.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Slot</th>
                <th className="px-3 py-2">As written</th>
                <th className="px-3 py-2">Frozen pool match</th>
                <th className="px-3 py-2">Problems</th>
              </tr>
            </thead>
            <tbody>
              {pickLines.map((line) => (
                <tr key={line.lineNumber} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 tabular-nums text-muted">{line.lineNumber}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {line.kind === "NO_CALLS" ? "—" : line.slot ? `${line.slot}${WAIVER_SLOT_LABELS[line.slot - 1] ? ` · ${WAIVER_SLOT_LABELS[line.slot - 1]}` : ""}` : "?"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{line.kind === "NO_CALLS" ? "NO CALLS" : (line.rawName ?? line.text.trim())}</td>
                  <td className="px-3 py-2 text-ink">{line.match ? `${line.match.displayName}${line.match.team ? ` (${line.match.team})` : ""}` : "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-danger">{line.issues.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
