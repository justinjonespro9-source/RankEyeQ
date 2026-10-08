"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { WAIVER_ARTIFACT_AUTHORITY_LABEL, WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT } from "@/lib/waivers/artifacts/authority";
import type { WaiverArtifactImportPreview } from "@/lib/waivers/artifacts/import-model";
import {
  WAIVER_ARTIFACT_IMPORT_ROUTE,
  WAIVER_ARTIFACT_PREVIEW_ROUTE,
  WAIVER_ARTIFACT_TEXT_MAX_BYTES,
  WAIVER_ARTIFACT_UPLOAD_FIELDS,
  WAIVER_ARTIFACT_UPLOAD_HEADER,
  WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE,
  WAIVER_ARTIFACT_UPLOAD_MAX_BYTES,
} from "@/lib/waivers/artifacts/upload-limits";

const inputClass = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";

const EMPTY_FORM = {
  expectedContentChecksum: "",
  sngArtifactId: "",
  sngRevision: "",
  sngAcceptanceId: "",
  sngAcceptedAt: "",
  attestedPublicationState: "ACCEPTED",
  sourceReference: "",
  sourceObservedAt: "",
};
type FormState = typeof EMPTY_FORM;

const FIELDS: Array<{ key: Exclude<keyof FormState, "attestedPublicationState">; label: string; placeholder?: string }> = [
  { key: "expectedContentChecksum", label: "Expected SHA-256 (from SNG's authenticated download)", placeholder: "64 lowercase hex" },
  { key: "sngArtifactId", label: "SNG artifact ID" },
  { key: "sngRevision", label: "SNG revision" },
  { key: "sngAcceptanceId", label: "SNG acceptance ID" },
  { key: "sngAcceptedAt", label: "SNG acceptance time (exact ISO UTC)", placeholder: "2026-10-07T15:00:00.000Z" },
  { key: "sourceReference", label: "SNG publication source reference" },
  { key: "sourceObservedAt", label: "When you observed it on SNG (Chicago or ISO)", placeholder: "YYYY-MM-DDTHH:MM" },
];

type UploadFailure = { ok: false; code: string; error: string };
type ImportSuccess = { ok: true; artifactId: string; revision: number; alreadyImported: boolean; importedAt: string };

async function gzipFile(file: File): Promise<Blob> {
  return new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

async function postUpload<T>(route: string, fields: Record<string, string | Blob>): Promise<T | UploadFailure> {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  try {
    const response = await fetch(route, {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { [WAIVER_ARTIFACT_UPLOAD_HEADER]: WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE },
    });
    return (await response.json()) as T | UploadFailure;
  } catch {
    return { ok: false, code: "NETWORK", error: "The upload did not complete" };
  }
}

/**
 * File → read-only preview → explicit attestation → import. The artifact is
 * gzip-compressed in the browser and re-sent unchanged on import; the server
 * rebuilds the preview and refuses changed content or a stale fingerprint.
 */
export function WaiverArtifactImportPanel({ weekId, authorityMode }: { weekId: string; authorityMode: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const compressed = useRef<Blob | null>(null);
  const [preview, setPreview] = useState<WaiverArtifactImportPreview | null>(null);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setAttested(false);
    setMessage(null);
  };
  const update = (key: keyof FormState, value: string) => {
    setForm({ ...form, [key]: value });
    reset();
  };
  const pickFile = (next: File | null) => {
    setFile(next);
    compressed.current = null;
    setError(null);
    reset();
  };

  const evidence = () => JSON.stringify({ weekId, ...form });

  const runPreview = () => {
    if (!file) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      if (file.size > WAIVER_ARTIFACT_TEXT_MAX_BYTES) {
        setError(`UPLOAD_TOO_LARGE: the artifact exceeds the ${WAIVER_ARTIFACT_TEXT_MAX_BYTES} byte contract limit`);
        return;
      }
      const gz = await gzipFile(file);
      if (gz.size > WAIVER_ARTIFACT_UPLOAD_MAX_BYTES - 64 * 1024) {
        setError("UPLOAD_TOO_LARGE: the compressed artifact exceeds the upload limit");
        return;
      }
      compressed.current = gz;
      const result = await postUpload<{ ok: true; preview: WaiverArtifactImportPreview }>(WAIVER_ARTIFACT_PREVIEW_ROUTE, {
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.artifact]: gz,
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.evidence]: evidence(),
      });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setAttested(false);
    });
  };

  const runImport = () => {
    const gz = compressed.current;
    if (!preview || !gz) return;
    setError(null);
    startTransition(async () => {
      const result = await postUpload<ImportSuccess>(WAIVER_ARTIFACT_IMPORT_ROUTE, {
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.artifact]: gz,
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.evidence]: evidence(),
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.previewFingerprint]: preview.previewFingerprint,
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.previewTextSha256]: preview.textSha256,
        [WAIVER_ARTIFACT_UPLOAD_FIELDS.attested]: attested ? "true" : "false",
      });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        if (result.code === "STALE_PREVIEW" || result.code === "CONTENT_MISMATCH") setPreview(null);
        return;
      }
      setMessage(
        result.alreadyImported
          ? `${result.artifactId} (revision ${result.revision}) was already imported; nothing was written.`
          : `Imported ${result.artifactId} (revision ${result.revision}) at ${result.importedAt}. Nothing was graded.`,
      );
      setPreview(null);
      setAttested(false);
      setForm(EMPTY_FORM);
      setFile(null);
      compressed.current = null;
      router.refresh();
    });
  };

  const authorityBlocked = authorityMode !== "OPERATOR_ATTESTED";

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <h3 className="font-display text-lg font-semibold text-ink">Import SNG canonical artifact</h3>
      <p className="mt-1 text-sm text-muted">
        Choose the exact artifact file downloaded from SNG and enter the acceptance evidence SNG&apos;s authenticated surface shows. Preview writes nothing;
        importing never grades.
      </p>
      <p className="mt-2 text-xs text-muted">{WAIVER_ARTIFACT_AUTHORITY_LABEL}.</p>
      {authorityBlocked ? (
        <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink" role="status">
          Import is disabled: SNG publication authority cannot be established. Preview remains available for review.
        </p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="text-sm text-muted">
            {field.label}
            <input className={inputClass} value={form[field.key]} placeholder={field.placeholder} maxLength={500} onChange={(e) => update(field.key, e.target.value)} />
          </label>
        ))}
        <label className="text-sm text-muted">
          SNG publication state you observed
          <select className={inputClass} value={form.attestedPublicationState} onChange={(e) => update("attestedPublicationState", e.target.value)}>
            <option value="ACCEPTED">ACCEPTED</option>
            <option value="SUPERSEDED">SUPERSEDED</option>
            <option value="WITHDRAWN">WITHDRAWN</option>
          </select>
        </label>
      </div>
      <label className="mt-3 block text-sm text-muted">
        Artifact file (exact bytes, JSON)
        <input
          className={inputClass}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            pickFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </label>
      {file ? <p className="mt-1 text-xs text-muted">{`${file.name} · ${file.size} bytes`}</p> : null}
      <div className="mt-3">
        <Button type="button" variant="secondary" size="sm" disabled={pending || !file} onClick={runPreview}>
          {pending && !preview ? "Previewing…" : "Preview (read-only)"}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            <span className="font-medium text-ink">Status:</span> {preview.status} · <span className="font-medium text-ink">Authority:</span>{" "}
            {preview.authorityMode === "OPERATOR_ATTESTED" ? WAIVER_ARTIFACT_AUTHORITY_LABEL : preview.authorityMode}
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-muted">Artifact</dt>
              <dd className="font-mono text-ink">{preview.summary ? `${preview.summary.artifactId} · rev ${preview.summary.revision}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Series</dt>
              <dd className="font-mono text-xs text-ink">{preview.summary?.seriesKey ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Content checksum (integrity only)</dt>
              <dd className="break-all font-mono text-xs text-ink">{preview.summary?.contentChecksum ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Text SHA-256 / bytes</dt>
              <dd className="break-all font-mono text-xs text-ink">
                {preview.textSha256} / {preview.byteLength}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Contract</dt>
              <dd className="text-xs text-ink">
                {preview.contract
                  ? `${preview.contract.schemaVersion} · ${preview.contract.rulesetCode}@${preview.contract.rulesetVersion} · ${preview.contract.engineVersion}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Acceptance (inside the bytes)</dt>
              <dd className="text-xs text-ink">{preview.acceptance ? `${preview.acceptance.id} · ${preview.acceptance.acceptedAt} · ${preview.acceptance.status}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Succession</dt>
              <dd className="text-xs text-ink">
                latest {preview.succession.latestArtifactId ? `${preview.succession.latestArtifactId} (rev ${preview.succession.latestRevision}, ${preview.succession.latestState})` : "none"} ·{" "}
                {preview.succession.predecessorAction}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Input fingerprint</dt>
              <dd className="break-all font-mono text-xs text-ink">{preview.previewFingerprint}</dd>
            </div>
          </dl>
          {preview.blockers.length ? (
            <ul className="space-y-1 rounded-md border border-danger/30 bg-danger-soft p-3">
              {preview.blockers.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="text-danger">
                  <span className="font-medium">{issue.code}</span> — {issue.message}
                </li>
              ))}
              {preview.verification.issues.map((issue, index) => (
                <li key={`v-${index}`} className="text-xs text-danger">
                  {issue.code}: {issue.detail}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.advisories.length ? (
            <ul className="space-y-1 rounded-md border border-border bg-surface p-3">
              {preview.advisories.map((issue) => (
                <li key={issue.code} className="text-muted">
                  <span className="font-medium text-ink">{issue.code}</span> — {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={attested} disabled={!preview.importEnabled} onChange={(e) => setAttested(e.target.checked)} />
            <span className="text-muted">{WAIVER_ARTIFACT_IMPORT_ATTESTATION_TEXT}</span>
          </label>
          <Button type="button" size="sm" disabled={pending || !preview.importEnabled || !attested} onClick={runImport}>
            {pending ? "Importing…" : "Import artifact"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
