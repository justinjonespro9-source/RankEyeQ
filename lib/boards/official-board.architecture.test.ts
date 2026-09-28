import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const rel = (file: string) => path.relative(root, file);

/** Presentation / history modules that competitive code must never reach. */
const FORBIDDEN_MODULES = [
  "lib/boards/official-board.ts",
  "lib/official-board-actions.ts",
  "lib/weekly-content.ts",
  "lib/admin/official-boards.ts",
  "lib/admin/official-boards-actions.ts",
];
const FORBIDDEN_DELEGATES =
  /\.(officialBoardPublication|officialBoardVersion|officialBoardVersionPick|weeklyContent)\b/;

function listTs(dir: string): string[] {
  return readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => path.join(root, dir, name));
}

const COMPETITIVE_ENTRIES = [
  "lib/grading.ts",
  "lib/scoring.ts",
  "lib/consensus-snapshot.ts",
  "lib/contest-lifecycle.ts",
  "lib/contest-defaults.ts",
  "lib/timing/partial-lock.ts",
  "lib/timing/kickoff-locks.ts",
  "lib/leaderboards.ts",
  "lib/competitive-resume.ts",
  "lib/competitive-resume-data.ts",
  "lib/live-rankiq.ts",
  "lib/live-provisional.ts",
  "lib/ranking-scoring-versions.ts",
].map((file) => path.join(root, file))
  .concat(listTs("lib/reserves"), listTs("lib/eligibility"));

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || rel(file).startsWith("lib/generated/")) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveImport(file, match[1] ?? match[2] ?? match[3]!);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(full);
  }
  return out;
}

describe("Official Boards architecture: competitive code never reads board versions", () => {
  it.each(COMPETITIVE_ENTRIES.map((file) => [rel(file), file]))(
    "%s cannot reach Official Board / WeeklyContent modules or tables",
    (_label, entry) => {
      const closure = importClosure(entry);
      const reached = [...closure].map(rel).filter((file) => FORBIDDEN_MODULES.includes(file));
      expect(reached).toEqual([]);
      const readers = [...closure]
        .filter((file) => FORBIDDEN_DELEGATES.test(readFileSync(file, "utf8")))
        .map(rel);
      expect(readers).toEqual([]);
    },
  );

  it("PUBLISHED / FINAL history is only ever created by the canonical service, never mutated", () => {
    const sources = [...walk(path.join(root, "lib")), ...walk(path.join(root, "app"))].map((file) => ({
      file: rel(file),
      source: readFileSync(file, "utf8"),
    }));
    const mutators = sources
      .filter(({ source }) =>
        /\.(officialBoardVersion|officialBoardVersionPick)\.(update|updateMany|upsert|delete|deleteMany)\(/.test(source) ||
        /\.officialBoardVersionPick\.(create|createMany)\(/.test(source) ||
        /\.officialBoardPublication\.(delete|deleteMany|updateMany|upsert)\(/.test(source),
      )
      .map(({ file }) => file);
    expect(mutators).toEqual([]);
    const creators = sources
      .filter(({ source }) =>
        /\.(officialBoardVersion|officialBoardPublication)\.(create|createMany|update)\(/.test(source),
      )
      .map(({ file }) => file);
    expect(creators).toEqual(["lib/boards/official-board.ts"]);
  });

  it("Official Boards admin never publishes, changes authority or touches competitive picks", () => {
    for (const file of [
      "lib/admin/official-boards.ts",
      "lib/admin/official-boards-actions.ts",
      "app/admin/official-boards/page.tsx",
    ]) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/publishOfficialBoard\b|publishOfficialBoardAction/);
      expect(source, file).not.toMatch(/\.(rankingSubmission|rankingPick)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(source, file).not.toMatch(/authority\s*:/);
      // The activation cutoff can never be overridden from admin repair.
      expect(source, file).not.toMatch(/ensureOfficialBoardFinalsFor\w+\([^)]*\{/);
      expect(source, file).not.toMatch(/saveSubmissionPicks|submitRanking|healPrematureWeekLocks|updateWeekTiming/);
    }
  });

  it("every gradeContest caller runs the FINAL backstop first", () => {
    const callers = [...walk(path.join(root, "lib")), ...walk(path.join(root, "app"))].filter(
      (file) => rel(file) !== "lib/grading.ts" && /await gradeContest\(/.test(readFileSync(file, "utf8")),
    );
    expect(callers.length).toBeGreaterThanOrEqual(6);
    for (const file of callers) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        if (!/await gradeContest\(/.test(line)) return;
        const window = lines.slice(Math.max(0, index - 3), index).join("\n");
        expect(window, `${rel(file)}:${index + 1}`).toMatch(/await ensureOfficialBoardFinalsForContest\(/);
      });
    }
  });
});
