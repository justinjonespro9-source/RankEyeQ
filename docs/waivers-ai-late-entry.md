# Waivers — controlled administrative late entry (Stage 4B.3B)

An exception for **delayed administrative recording** of an AI WaiverEyeQ
prediction that already existed before the contest lock. It is not permission
to create or change a prediction after the lock. V1 covers AI profiles on
WaiverEyeQ only; human and creator boards have no late entry, and Rankings is
unchanged.

A late-entered board is displayed as **LATE-ENTERED — VERIFIED PRE-LOCK** with
the verified original prediction time, the actual import time and the
provenance of the prompt the AI actually answered.

## Records

| Record                              | Purpose |
| ----------------------------------- | ------- |
| `WaiverAiHistoricalEvidence` (4B.3A) | The exact original response text, its sha256, the AI profile, model label, contest, position and pinned snapshot, and the database-clock `recordedAt`. Record-only. |
| `WaiverAiLateEntryVerification`      | Append-only, sequential per evidence. The evidence basis (`WaiverAiLateEntryBasis`), how the original time was established (`WaiverAiLateEntryTimestampMethod`), the time, source reference, optional byte-exact provider file (bytes, sha256, length, whether it contains the exact response), the original prompt as known, the canonical prompt used for validation, prompt equivalence (`WaiverAiPromptEquivalence`), the parser version, the strict-parse board fingerprint and call count, and the admin's review and attestation. The **database** derives the time, its method, containment, prompt equivalence, `eligible` and `ineligibleReason`. |
| `WaiverAiLateEntryApproval`          | Immutable. One per (contest, AI profile); one per verification; names the new board and revision ids, the evidence, snapshot, response sha256 and board fingerprint it approves. `approvedAt` is the database clock. |

The board itself is an ordinary `SYSTEM_OPERATED` `WaiverSubmission` with one
`SUBMISSION` revision, its calls and its verbatim `WaiverAiResponse`, so every
existing reader (grading, board selection, AI/All views) treats it like any
other locked board.

## Workflow (`/admin/waivers/ai/[profileId]/[contestId]` → Late Entry Override)

1. Record the original response as historical evidence (4B.3A) — the exact text
   or file bytes. The page shows the evidence's recorded time, source, sha256
   fingerprint, latest review and the strict frozen-pool parse. An invalid parse
   rejects the whole response; there is nothing to approve.
2. Review the evidence as **TEXT_CONFIRMED** (4B.3A review history).
3. **Record verification** (step 1): choose the evidence basis, supply the
   provider file when required, record the original prompt as far as it is
   known, a source reference, an evidence review and attestation, and tick the
   attestation. The result (eligible, or the reason it is not) is stored and
   shown in the verification history.
4. **Approve late entry** (step 2, a separate action): type the first 12
   characters of the response sha256, tick the approval, optionally add a note.
   The approval and the locked board are created in one transaction.

One authorized administrator may perform both steps; they are always two
explicit actions in separate transactions, each recorded with its admin and
database time.

Picks are never regenerated, corrected, replaced or reordered: the server
re-parses the stored evidence text at both steps and refuses if the parse, the
confirmed preview, the canonical prompt sha256 or the board fingerprint changed.

## Evidence policy

| Basis | Original time | Competitive? |
| ----- | ------------- | ------------ |
| **Recorded in RankEyeQ before the lock** (`DATABASE_RECORDED_PRE_LOCK`) | Forced by the database to the evidence's `recordedAt` (`DATABASE_CLOCK`). | Yes, if all rules below pass. The database clock proves the text existed before the lock. |
| **Original provider record** (`PROVIDER_ARTIFACT`), message timestamp present | Derived **by the database** from the stored file bytes: the provider's own timestamp on an assistant-attributed message that itself holds the exact response (`PROVIDER_MESSAGE`). | Yes, if all rules below pass. |
| **Original provider record**, no message timestamp | An admin may record the time they read (`ADMIN_READ_FROM_ARTIFACT`). | **Never** (`NO_PROVIDER_MESSAGE_TIME`). Record-only. |
| **Operator-attested only** (`OPERATOR_ATTESTED`) | Admin-stated (`ADMIN_STATED`). | **Never** (`OPERATOR_ATTESTED_ONLY`). Record-only. |

A time read or entered by an administrator never establishes eligibility. The
provider message time is read only from `create_time`, `created_at`,
`createdAt` or `timestamp` (first valid in that order; epoch seconds or
milliseconds, or ISO-8601 with an explicit zone) on a JSON object attributed to
the assistant (`role`, `sender` or `author.role` = `assistant`) that holds the
exact response in one of its own string values. A conversation-level, export,
user-message or zone-less time never counts, nor does any time in a non-JSON
file. When several such messages qualify, the earliest is used. The admin
preview (`lib/waivers/ai/provider-artifact.ts`) mirrors these rules, but the
database functions (`waiver_ai_artifact_contains`,
`waiver_ai_artifact_message_time`) decide; values reported by the application
are overwritten.

Refused outright (nothing saved): a time in the future; a time after the
evidence was recorded; an admin-entered time that differs from the provider
message timestamp by more than 60 s (conflicting); a provider file that is not
UTF-8 or whose bytes do not match the sha256 computed in the browser.

A verification is **eligible** only if, in this order (the first failure is the
recorded reason):

1. the basis is not operator-attested (`OPERATOR_ATTESTED_ONLY`);
2. the evidence's snapshot is the contest's pinned snapshot (`SNAPSHOT_MISMATCH`);
3. a provider file contains the exact response (`ARTIFACT_MISSING_RESPONSE`);
4. a provider file supplies a message timestamp (`NO_PROVIDER_MESSAGE_TIME`);
5. there is an original time (`NO_ORIGINAL_TIME`);
6. it is strictly before `locksAt` (`NOT_BEFORE_LOCK`);
7. it is not before the snapshot was frozen (`BEFORE_SNAPSHOT_FROZEN`);
8. the evidence's latest review is `TEXT_CONFIRMED` (`TEXT_NOT_CONFIRMED`);
9. no other unrejected evidence for the same AI and contest has a different
   response (`AMBIGUOUS_RESPONSES`). Rejected evidence is excluded from this
   check; its full history is preserved.

Insufficient evidence is still recorded, with its reason, and stays
non-competitive. The original provider file bytes and sha256 are preserved
exactly.

## Historical prompt provenance

A late entry never claims the AI answered the canonical `WAIVEREYEQ_AI_V1`
prompt unless that is shown. Each verification records separately:

| Field | Meaning |
| ----- | ------- |
| `originalPromptVersion` | The actual original prompt version or name, when known (free text). |
| `originalPromptReference` | Where the original prompt is kept, when available. |
| `originalPromptText` / `originalPromptSha256` | The exact original prompt text, when preserved; its sha256 is computed by the database. |
| `canonicalPromptVersion` / `canonicalPromptSha256` | The current canonical Waivers prompt of the pinned snapshot, used only to validate the response's format and pool. |
| `promptEquivalence` | Database-derived: `VERIFIED` only when the preserved text is byte-identical to the canonical prompt; `DIFFERENT` when a prompt text or version is recorded that is not; `UNKNOWN` when nothing is known. |

- A version label resembling the canonical prompt (`WAIVEREYEQ_AI_V…`, any case)
  is refused unless the byte-identical canonical prompt text is preserved.
- The late board's `WaiverAiResponse.promptVersion` / `promptSha256` name the
  canonical prompt only when equivalence is `VERIFIED`; otherwise they are
  **null**. The database admits a response without its prompt only on the board
  named by an approval inserted in the same transaction, and the commit check
  requires exactly this rule. On-time AI imports must still record their prompt.
- The AI response text itself is stored verbatim and never altered.
- Week 5 legacy/external predictions therefore appear as `UNKNOWN` or
  `DIFFERENT`, with whatever original prompt details are known.

## Provider-file download

`GET /api/admin/waivers/ai/late-entry/[verificationId]/provider-file?evidenceId=…`
(linked from each verification in the admin page) returns the exact stored
bytes:

- requires an admin session (`assertAdmin`) and re-checks the admin role in the
  database; refuses cross-site requests (`Sec-Fetch-Site`);
- the verification must belong to the given evidence and carry a file; the
  bytes are re-checked against the stored sha256 and length before sending;
- `application/octet-stream` attachment (sanitized filename), `no-store,
  private`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  and an `X-RankEyeQ-Sha256` header;
- read-only (no database writes); only ids are logged. There is no public or
  unauthenticated URL.

## Database safeguards

- **No lock change, no backdating.** `locksAt` is never written. The board,
  revision and approval times are the database clock at import; the original
  prediction time lives only on the verification.
- **One narrow authority.** The four existing lock guards
  (`waiver_submission_guard`, `waiver_revision_guard`, `waiver_call_guard`,
  `waiver_ai_response_guard`) are re-declared with one added branch each: a
  post-lock write is admitted only when `waiver_ai_late_entry_in_transaction`
  returns an approval **inserted by the current transaction** (`xmin`) naming
  exactly that board, revision and response. Every other line is unchanged
  (pinned by `lib/waivers/ai/late-entry-schema.test.ts`). There is no session
  flag, setting, override or privileged role; a committed approval authorizes
  nothing.
- **Verification guard** (`WaiverAiLateEntryVerification_guard`): admin only;
  sequential; bound to its evidence; derives the time, method, containment,
  prompt sha256 and equivalence, and eligibility as above.
- **Approval guard** (`WaiverAiLateEntryApproval_guard`): admin only; the
  verification is eligible, the latest for its evidence, and was **not** created
  in the same transaction (separate action); every copied field matches it;
  takes the week's grade lock; the contest is past `locksAt`; pinned snapshot;
  original time before the lock; text confirmed; not ambiguous; active AI
  competitor; no existing board for that AI and contest; no grade run for the
  week; the named board and revision ids are new.
- **Deferred commit check** (`WaiverAiLateEntryApproval_board`): the board is
  LOCKED with current = locked = the approved revision and
  `submittedAt = lockedAt = approvedAt`; it has exactly that one revision
  (number 1, SUBMISSION, created at `approvedAt` by the approver); the stored
  calls recompute to the approved board fingerprint; the AI response is the
  evidence's exact text, model and parser, with the prompt rule above. Anything
  else rolls back the whole transaction.
- **Response prompt guard** (`WaiverAiResponse_prompt_guard`): a response
  without its prompt is refused unless it belongs to a same-transaction approved
  late entry.
- **Immutable history.** Verifications and approvals refuse UPDATE, DELETE and
  TRUNCATE (fixture maintenance may delete in tests). Unique indexes prevent a
  second approval per verification and per (contest, AI). The approval's board
  and revision foreign keys are deferred so the approval can be inserted first.
- **Lock stamping is unchanged.** Ordinary boards keep the existing
  SUBMITTED → LOCKED stamp (`lockedAt = locksAt`, final pre-lock revision). A
  late board goes DRAFT → LOCKED directly with `lockedAt` = the import time; its
  only revision is created after the lock and is never presented as pre-lock.

## Competitive integrity

- Public consensus is HUMANS-only and never includes a late entry.
- AI and All Participants views include an approved late entry with its
  designation.
- Grading uses the board's locked revision, so the next grade run includes the
  late board like any other. Late entry is closed once the week has any grade
  run, so a late entry never changes an existing run; nothing grades, approves
  or updates a leaderboard as part of a late entry.
- Historical evidence, verification or approval alone never affects consensus,
  grading or leaderboards; only the board created by an approval does.
- Ordinary human and creator submission rules and existing competitive
  submissions are unchanged.

## Threat model (summary)

| Threat | Control |
| ------ | ------- |
| Post-lock prediction presented as pre-lock | Admin-read and admin-stated times are never eligible; DB-recorded time forced from `recordedAt`; provider time derived by the database only from the assistant message holding the exact text; future, post-recording and conflicting times refused; time must precede the lock and follow the freeze. |
| Application spoofs containment or the time method | The database recomputes both from the stored bytes and overwrites what the application sends. |
| False canonical-prompt attestation | Equivalence derived by the database from byte-identical prompt text; canonical-looking labels refused without it; the board names the canonical prompt only when `VERIFIED`, enforced at commit. |
| Picks altered between evidence and board | Server re-parses stored evidence text; DB recomputes the call fingerprint and compares the response text at commit. |
| Approval replay or reuse | One approval per verification and per (contest, AI); authority only for the transaction that inserted the approval. |
| Generic lock bypass | No flag or setting; each guard branch requires a same-transaction approval naming the exact ids. The services are reached only through admin Server Actions, and admin role is re-checked by the action, the service and the database. |
| Rubber-stamp approval | Verification and approval are separate transactions; typed sha confirmation; attestation recorded. |
| Provider-file exposure | Admin-only, same-origin, read-only download of exact bytes; never rendered or cached. |
| Partial writes | Single transaction plus deferred checks; any mismatch rolls back everything. |
| Choosing between conflicting responses | Ambiguity rule: another unrejected response for the same AI and contest blocks eligibility. |
| Changing graded results | Refused once the week has a grade run. |

## Known limits

- Provider files are not cryptographically signed by the provider. A stored
  file proves what the admin uploaded and what it says, not that the provider
  produced it; an edited export with a fabricated message timestamp would pass
  the format checks. The attestation, text-confirmed review and download for
  independent inspection are the controls.
- Only the JSON export shapes described above yield a message timestamp. Other
  formats (HTML exports, screenshots, PDFs) are preserved but record-only.
- A single admin may verify and approve (in separate actions); there is no
  two-person rule.
- Prompt equivalence is `VERIFIED` only for byte-identical text; a semantically
  equivalent prompt with different whitespace is recorded as `DIFFERENT`.
- The verification upload uses a Server Action (1 MB body limit): a provider
  file near the 512 KiB cap together with a very large original prompt text may
  exceed it and be refused without saving.
