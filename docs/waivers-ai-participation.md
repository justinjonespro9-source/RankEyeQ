# Waivers — AI participation (Stage 4B.3A)

AI competitors play WaiverEyeQ through `/admin/ai` → **Waivers**. An admin
copies the frozen-pool prompt, runs it in the AI, pastes the response, previews
the strict parse and submits. The board is a normal Waiver board with
`authority = SYSTEM_OPERATED`; the verbatim AI response is stored immutably with
the revision it produced.

## What is stored

| Record                             | Purpose                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WaiverSubmission` (SYSTEM_OPERATED) | One board per AI profile and contest (`@@unique([contestId, universalProfileId])`). `createdByUserId` is the importing admin.                                                     |
| `WaiverSubmissionRevision` / `WaiverCall` | Append-only SUBMISSION revisions, exactly like owner boards. The existing Waivers lock triggers apply unchanged.                                                          |
| `WaiverAiResponse`                 | One per SYSTEM_OPERATED revision: exact text, sha256, byte length, model label, prompt version + sha256, parser version, snapshot, importing admin, `importedAt` (database clock), optional `statedGeneratedAt` and source. |
| `WaiverAiHistoricalEvidence`       | Record-only historical predictions. Never a board.                                                                                                                              |
| `WaiverAiHistoricalEvidenceReview` | Append-only, sequential review history for evidence.                                                                                                                            |

`importedAt` / `recordedAt` are set by the database clock and are the only
trusted times. `statedGeneratedAt` / `statedSourceAt` are what an admin typed;
they are displayed as "admin-stated, unverified" and are never proof of when a
prediction was made.

## Prompt — `WAIVEREYEQ_AI_V1`

Built only from the contest's pinned frozen snapshot (eligible CANDIDATE rows at
the position, in frozen order). It states: this is WaiverEyeQ, not Rankings;
predict the highest Half-PPR scorers; up to 3 picks (QB/RB/TE/DEF) or 5 (WR),
capped by the eligible pool, fewer allowed; no reserves; ordered from #1; use
only the pool, copy names exactly, never invent or substitute; `NO CALLS` is
allowed; return only the list. It names the snapshot version and fingerprint
and contains no timestamps, so the same snapshot always yields the same text and
sha256. A board records the prompt sha256 it answered; a submit is refused
(`PROMPT_CHANGED`) if the contest was re-pinned after the prompt was copied.
The only exception is an approved late entry whose original prompt is not
verified to be this prompt: its response stores no prompt, and the original
prompt provenance is kept on the late-entry verification (see
[waivers-ai-late-entry.md](waivers-ai-late-entry.md)).

## Strict parser — `WAIVEREYEQ_AI_PARSER_V1`

`lib/waivers/ai/response-parser.ts`. It shares only line extraction with the
Rankings parser (`lib/text/ranked-list-lines.ts`, behaviour-identical for
Rankings). Accepted: numbered lists, plain/bulleted lines, CSV/TSV/pipe tables
(with headers), a copied prompt pool line, and a lone `NO CALLS`. Ignored: blank
lines, code fences, table separators, header rows. Names resolve by exact
normalized name (suffix-aware, as `playerNamesCanMerge`) against the pinned
snapshot only; DEF also by team abbreviation, full name or nickname.

Any of these rejects the whole response — nothing is skipped, replaced,
reordered or truncated: unparseable/commentary lines, unknown, ambiguous,
ineligible or wrong-position players, team contradictions, duplicate players,
duplicate/missing/out-of-order slots, mixed numbering, `NO CALLS` mixed with
picks, more picks than allowed, empty, oversized (> 64 KiB) or unstorable text.
The server re-parses the original text on submit; the confirmed pick ids from
the preview are compared, never written.

## Byte-exactness

The server hashes exactly the string it receives and requires it to match the
sha256 the browser computed over the same string; the database CHECK recomputes
`sha256(convert_to(responseText, 'UTF8'))`. A browser textarea normalizes line
endings to LF, so pasted text is stored as pasted-into-the-browser. For
evidence where the original bytes matter, **Load original file** reads the file,
decodes it as strict UTF-8 (BOM kept), shows it read-only and requires the file
sha256 to equal the stored text's sha256. Text that is not valid UTF-8, contains
NUL or lone surrogates is refused rather than altered.

## Database authority

- `WaiverSubmission_authority_guard`: OWNER_AUTHORED boards belong to the
  creating login's own HUMAN/CREATOR profile; SYSTEM_OPERATED boards belong to an
  active (`status ACTIVE`, `competitorActive`) AI profile and are created by an
  admin. Anything else is refused.
- `WaiverSubmissionRevision_authority_guard`: SYSTEM_OPERATED revisions are
  SUBMISSION only, by an admin, for a still-active AI.
- Deferred `WaiverSubmissionRevision_ai_response` / `WaiverSubmission_ai_shape`:
  at commit every SYSTEM_OPERATED revision has its `WaiverAiResponse`, and a
  SYSTEM_OPERATED board is submitted with a current revision.
- `WaiverAiResponse_guard`: immutable; refused at or after `locksAt`; must match
  its revision's board, contest, position, pinned snapshot, author and call
  count (`noCalls`).
- Evidence and reviews are append-only; `recordedAfterLock` and times come from
  the database clock; reviews are strictly sequential. TRUNCATE is refused on
  all three tables. Only fixture maintenance may delete (tests).

No board, revision or call can be inserted at or after `locksAt`, for any
authority, except through the Stage 4B.3B approved late-entry path (see
[`waivers-ai-late-entry.md`](./waivers-ai-late-entry.md)).

## Index replacement

`@@unique([contestId, createdByUserId])` ("one board per login per contest") is
replaced by the partial unique
`WaiverSubmission_contestId_createdByUserId_owner_key … WHERE authority =
'OWNER_AUTHORED'`, so one admin can import boards for several AIs while each
login still has at most one owner board per contest. The migration creates the
partial index before dropping the old one. Requires the Prisma
`partialIndexes` preview feature (enabled in `schema.prisma`).

**Production audit (read-only, before any deployment):** every existing
`WaiverSubmission` must be OWNER_AUTHORED, there must be no duplicate
`(contestId, createdByUserId)` among them, and each must belong to its creating
login's HUMAN/CREATOR profile (the new insert guard does not re-check existing
rows, but this confirms nothing pre-existing contradicts it).

Result (2026-10-09T00:48Z, one REPEATABLE READ READ ONLY transaction, rolled
back): PASS. 5 `WaiverSubmission` rows, all OWNER_AUTHORED HUMAN (3 LOCKED, 2
SUBMITTED); 0 duplicate `(contestId, createdByUserId)`; 0 owner rows that are
not the creating login's own HUMAN/CREATOR profile; the old unique index exists;
no name collisions with the new tables, type, index, functions or triggers;
`waiver_utc_now`, `waiver_fixture_maintenance` and `waiver_require_admin`
present; 42 migrations applied, 4B.3A not applied.

## Separation (Humans / AI / All)

`lib/waivers/competitor-category.ts`: HUMANS = OWNER_AUTHORED HUMAN/CREATOR
boards; AI = SYSTEM_OPERATED AI boards; ALL = both; any other combination is in
no category. The public post-lock consensus uses HUMANS only. Grading (4B.3) is
per board — no score, honor or rank depends on other boards — so AI boards are
graded in the same week-atomic run without affecting human results. The Waivers
leaderboard does not read grades yet; when it does (4B.4) it must filter by
category and default to HUMANS. Admin operational counts include AI boards.

## Historical evidence (e.g. Week 5)

Record-only: on its own it never creates a submission, revision, call, grade,
approval, consensus or leaderboard entry. Records made at or after the contest
lock are labelled **RECORDED AFTER LOCK — NOT COMPETITIVE**. Stage 4B.3A builds
the storage and preview only; the eight Week 5 responses are not imported and no
Week 5 prediction is regenerated.

The only path from evidence to a board is the Stage 4B.3B controlled late entry
(an eligible verification plus a separate, immutable approval); see
[`waivers-ai-late-entry.md`](./waivers-ai-late-entry.md).
