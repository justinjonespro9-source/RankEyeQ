import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WAIVERS_DIR = path.join(ROOT, "lib/waivers");

const IMPORT_RE =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

type ImportRef = { specifier: string; typeOnly: boolean };

function readImports(source: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    refs.push({ specifier: match[3], typeOnly: Boolean(match[2]) });
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
    refs.push({ specifier: match[1], typeOnly: false });
  }
  return refs;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "generated") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

const FIXTURES_DIR = path.join(WAIVERS_DIR, "__fixtures__");

function waiverSourceFiles(): string[] {
  return walk(WAIVERS_DIR).filter((file) => !/\.test\.ts$/.test(file) && !file.startsWith(FIXTURES_DIR + path.sep));
}

function normalizeSpecifier(fromFile: string, specifier: string): string {
  if (specifier.startsWith("@/")) return specifier.slice(2).replace(/\.(ts|tsx)$/, "");
  if (specifier.startsWith(".")) {
    return path
      .relative(ROOT, path.resolve(path.dirname(fromFile), specifier))
      .replace(/\.(ts|tsx)$/, "");
  }
  return specifier;
}

/** DB-free modules (keys are paths under lib/waivers without extension). */
const PURE_MODULES = [
  "constants",
  "precision",
  "board-shape",
  "scoring",
  "production",
  "ranking",
  "lock-time",
  "call-validation",
  "fingerprint",
  "access",
  "snapshot/input",
  "snapshot/match",
  "snapshot/eligibility",
  "snapshot/completeness",
  "snapshot/preview-model",
  "snapshot/correct-model",
  "snapshot/errors",
  "canonical/contract",
  "canonical/serialization",
  "canonical/artifact-types",
  "canonical/artifact-verifier",
  "canonical/team-crosswalk",
  "canonical/disposition",
  "canonical/identity",
  "canonical/policy",
  "canonical/preflight-model",
];
/** Competition and snapshot services, admin queries and server actions (DB + auth allowed). */
const SERVICE_MODULES = [
  "clock",
  "contests",
  "submissions",
  "corrections",
  "access-queries",
  "actions",
  "snapshot/facts",
  "snapshot/preview",
  "snapshot/freeze",
  "snapshot/correct",
  "snapshot/queries",
  "snapshot/actions",
  "canonical/preflight",
];

const ALLOWED_RUNTIME_IMPORTS = new Set([
  "lib/fantasy/competition-rank",
  "lib/db-target-guard",
  "lib/timing/chicago",
  "node:crypto",
  /** Snapshot matching / parsing / schedule predicates (pure, shared with Rankings imports). */
  "lib/nfl/player-identity",
  "lib/nfl/player-aliases",
  "lib/nfl/manual/parse-common",
  "lib/providers/nfl/eligibility",
]);
/**
 * The pure weekly-availability resolver (exact module only). Its DB store and
 * the Rankings availability engine stay banned.
 */
const ALLOWED_EXACT_EXCEPTIONS = new Set(["lib/eligibility/player-week-availability"]);
const ALLOWED_TYPE_ONLY_IMPORTS = new Set(["lib/generated/prisma/client"]);
const SERVICE_RUNTIME_IMPORTS = new Set([
  "lib/db",
  "lib/generated/prisma/client",
  "lib/auth/session",
  "lib/auth/participation",
  "lib/admin/access",
  "lib/rate-limit",
  "lib/request-ip",
  "lib/log",
  "next/cache",
]);
/** The only UI allowed to import Waivers, and what it may import at runtime. */
const WAIVERS_UI_DIRS = ["app/admin/waivers", "components/admin/waivers"];
const WAIVERS_UI_RUNTIME_IMPORTS = new Set([
  "lib/waivers/actions",
  "lib/waivers/snapshot/actions",
  "lib/waivers/snapshot/queries",
  "lib/waivers/constants",
]);
/** Rankings/Official Board/leaderboard modules Waivers must never depend on. */
const BANNED_PREFIXES = [
  "lib/submissions",
  "lib/submission",
  "lib/contest",
  "lib/official-board",
  "lib/boards",
  "lib/reserves",
  "lib/eligibility",
  "lib/scoring",
  "lib/grading",
  "lib/leaderboard",
  "lib/consensus",
  "lib/timing/week",
  "lib/timing/submission",
  "lib/creator-verification",
  "lib/nfl/player-availability",
];

const moduleName = (file: string) => path.relative(WAIVERS_DIR, file).replace(/\.ts$/, "").split(path.sep).join("/");

function referencesWaivers(fromFile: string, source: string): boolean {
  return readImports(source).some((ref) =>
    normalizeSpecifier(fromFile, ref.specifier).startsWith("lib/waivers"),
  );
}

/**
 * A Waivers script is any script that imports lib/waivers or touches the
 * Waiver* Prisma delegates / tables. It must import and call the Waivers DB
 * target guard.
 */
function checkWaiversScriptGuard(
  fileName: string,
  source: string,
): { isWaiversScript: boolean; ok: boolean } {
  const touchesWaivers =
    /waiver/i.test(path.basename(fileName)) ||
    /lib\/waivers/.test(source) ||
    /\.waiver(?:Snapshot(?:Entry|Correction)?|Contest|Submission(?:Revision)?|Call)\b/.test(source) ||
    /"Waiver(?:Snapshot(?:Entry|Correction)?|Contest|Submission(?:Revision)?|Call)"/.test(source);
  if (!touchesWaivers) return { isWaiversScript: false, ok: true };
  const importsGuard =
    /import\s*\{[^}]*\bassertWaiversScriptDatabaseTarget\b[^}]*\}\s*from\s*["'][^"']*lib\/waivers\/script-guard["']/.test(
      source,
    );
  const callsGuard = /\bassertWaiversScriptDatabaseTarget\s*\(/.test(source);
  return { isWaiversScript: true, ok: importsGuard && callsGuard };
}

describe("Waivers architecture isolation", () => {
  it("lib/waivers source files exist", () => {
    const names = waiverSourceFiles().map(moduleName).sort();
    expect(names).toEqual([...PURE_MODULES, ...SERVICE_MODULES, "script-guard"].sort());
  });

  it("lib/waivers imports only its tiered allowlist (services may use DB/auth; nothing uses Rankings)", () => {
    const violations: string[] = [];
    for (const file of waiverSourceFiles()) {
      const source = readFileSync(file, "utf8");
      const isService = SERVICE_MODULES.includes(moduleName(file));
      for (const ref of readImports(source)) {
        const target = normalizeSpecifier(file, ref.specifier);
        if (ALLOWED_EXACT_EXCEPTIONS.has(target)) continue;
        if (BANNED_PREFIXES.some((prefix) => target === prefix || target.startsWith(prefix))) {
          violations.push(`${path.relative(ROOT, file)} -> ${ref.specifier} (banned)`);
          continue;
        }
        if (target.startsWith("lib/waivers/")) continue;
        if (ALLOWED_RUNTIME_IMPORTS.has(target)) continue;
        if (ref.typeOnly && ALLOWED_TYPE_ONLY_IMPORTS.has(target)) continue;
        if (isService && SERVICE_RUNTIME_IMPORTS.has(target)) continue;
        violations.push(`${path.relative(ROOT, file)} -> ${ref.specifier}${ref.typeOnly ? " (type)" : ""}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("pure modules never import the DB, auth, the DB guard, or Waiver service modules", () => {
    for (const name of PURE_MODULES) {
      const file = path.join(WAIVERS_DIR, `${name}.ts`);
      const refs = readImports(readFileSync(file, "utf8"));
      const imports = refs.map((r) => normalizeSpecifier(file, r.specifier));
      expect(imports.filter((i) => i === "lib/db" || i === "lib/db-target-guard" || i.startsWith("lib/auth"))).toEqual([]);
      expect(
        imports.filter((i) => i.startsWith("lib/waivers/") && !PURE_MODULES.includes(i.slice("lib/waivers/".length))),
      ).toEqual([]);
      expect(refs.filter((r) => !r.typeOnly && normalizeSpecifier(file, r.specifier) === "lib/generated/prisma/client")).toEqual([]);
    }
  });

  it("only the actions modules are server-action modules, and they export only async functions", () => {
    for (const file of waiverSourceFiles()) {
      const source = readFileSync(file, "utf8");
      const isActions = moduleName(file) === "actions" || moduleName(file) === "snapshot/actions";
      expect(/^\s*["']use server["']/.test(source), path.relative(ROOT, file)).toBe(isActions);
      if (!isActions) continue;
      const exports = [...source.matchAll(/^export\s+(?!type\b)(\w+(?:\s+\w+)?)/gm)].map((m) => m[1]);
      expect(exports.every((kind) => kind === "async function")).toBe(true);
    }
  });

  it("application code never enables the fixture-maintenance trigger bypass", () => {
    const roots = ["app", "components", "lib", "scripts"].map((d) => path.join(ROOT, d));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (/\.test\.ts$/.test(file) || file.startsWith(FIXTURES_DIR + path.sep)) continue;
        if (/waiver_fixture_maintenance/.test(readFileSync(file, "utf8"))) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("canonical consumer modules never write, run raw SQL, or contact SNG", () => {
    const offenders: string[] = [];
    for (const file of waiverSourceFiles().filter((f) => moduleName(f).startsWith("canonical/"))) {
      const source = readFileSync(file, "utf8");
      for (const banned of [
        /\b\w+\s*\.\s*\w+\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\$(?:executeRaw|queryRaw|transaction)/,
        /\bfetch\s*\(/,
        /https?:\/\//,
        /sng-labs\//,
      ]) {
        if (banned.test(source)) offenders.push(`${path.relative(ROOT, file)}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no alphabetical tie helper, leaderboard qualification, or percentile badges in lib/waivers", () => {
    const hits: string[] = [];
    for (const file of waiverSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const banned of [/localeCompare/, /qualifyLeaderboardRows/, /badges\/percentile/, /Intl\.Collator/]) {
        if (banned.test(source)) hits.push(`${path.relative(ROOT, file)}: ${banned}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("only the admin Waivers UI imports lib/waivers, and only its actions, read-only queries and constants", () => {
    const roots = ["app", "components", "lib", "scripts", "prisma"].map((d) => path.join(ROOT, d));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.startsWith(WAIVERS_DIR + path.sep)) continue;
        const source = readFileSync(file, "utf8");
        if (!referencesWaivers(file, source)) continue;
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (!WAIVERS_UI_DIRS.some((dir) => rel.startsWith(`${dir}/`))) {
          offenders.push(rel);
          continue;
        }
        for (const ref of readImports(source)) {
          const target = normalizeSpecifier(file, ref.specifier);
          if (!target.startsWith("lib/waivers") || ref.typeOnly) continue;
          if (!WAIVERS_UI_RUNTIME_IMPORTS.has(target)) offenders.push(`${rel} -> ${ref.specifier}`);
          if (target === "lib/waivers/snapshot/queries" && !rel.startsWith("app/")) offenders.push(`${rel} -> queries outside a server page`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Waivers routes exist only under /admin and the nav link is admin-only", () => {
    const routeDirs = walk(path.join(ROOT, "app"))
      .map((file) => path.relative(ROOT, path.dirname(file)).split(path.sep).join("/"))
      .filter((dir) => /(^|\/)waivers(\/|$)/i.test(dir));
    expect(routeDirs.every((dir) => dir.startsWith("app/admin/waivers"))).toBe(true);
    const linkers: string[] = [];
    for (const root of ["app", "components", "lib"].map((d) => path.join(ROOT, d))) {
      for (const file of walk(root)) {
        if (/\.test\.ts$/.test(file)) continue;
        if (/["'`]\/admin\/waivers/.test(readFileSync(file, "utf8"))) linkers.push(path.relative(ROOT, file).split(path.sep).join("/"));
      }
    }
    const allowed = ["lib/admin/admin-nav.ts", "lib/waivers/snapshot/actions.ts", ...WAIVERS_UI_DIRS];
    expect(linkers.filter((file) => !allowed.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)))).toEqual([]);
  });

  it("every script that touches Waivers calls the Waivers DB target guard", () => {
    const failures: string[] = [];
    for (const file of walk(path.join(ROOT, "scripts"))) {
      const result = checkWaiversScriptGuard(file, readFileSync(file, "utf8"));
      if (result.isWaiversScript && !result.ok) failures.push(path.relative(ROOT, file));
    }
    expect(failures).toEqual([]);
  });
});

describe("checkWaiversScriptGuard (synthetic sources)", () => {
  it("ignores unrelated scripts", () => {
    expect(checkWaiversScriptGuard("scripts/backfill.ts", "import { prisma } from '@/lib/db';")).toEqual({
      isWaiversScript: false,
      ok: true,
    });
  });

  it("flags a Waivers script that touches the DB without the guard", () => {
    const src = `import { prisma } from "@/lib/db";\nawait prisma.waiverSnapshot.findMany();`;
    expect(checkWaiversScriptGuard("scripts/list.ts", src)).toEqual({ isWaiversScript: true, ok: false });
  });

  it("flags a script that touches Phase 2 competition delegates without the guard", () => {
    for (const delegate of ["waiverContest", "waiverSubmission", "waiverSubmissionRevision", "waiverCall"]) {
      const src = `import { prisma } from "@/lib/db";\nawait prisma.${delegate}.count();`;
      expect(checkWaiversScriptGuard("scripts/x.ts", src)).toEqual({ isWaiversScript: true, ok: false });
    }
  });

  it("flags a script named for waivers even without delegate usage", () => {
    expect(checkWaiversScriptGuard("scripts/import-waivers.ts", "console.log(1);").ok).toBe(false);
  });

  it("flags importing the guard without calling it", () => {
    const src = `import { assertWaiversScriptDatabaseTarget } from "@/lib/waivers/script-guard";\nimport { scoreWaiverBoard } from "@/lib/waivers/scoring";`;
    expect(checkWaiversScriptGuard("scripts/x.ts", src).ok).toBe(false);
  });

  it("flags calling a same-named function not imported from the Waivers guard", () => {
    const src = `function assertWaiversScriptDatabaseTarget() {}\nassertWaiversScriptDatabaseTarget();\nawait prisma.waiverSnapshotEntry.count();`;
    expect(checkWaiversScriptGuard("scripts/x.ts", src).ok).toBe(false);
  });

  it("accepts a guarded Waivers script", () => {
    const src = [
      `import { assertWaiversScriptDatabaseTarget } from "@/lib/waivers/script-guard";`,
      `assertWaiversScriptDatabaseTarget({ script: "freeze-snapshot" });`,
      `await prisma.waiverSnapshot.findMany();`,
    ].join("\n");
    expect(checkWaiversScriptGuard("scripts/freeze-waivers.ts", src)).toEqual({ isWaiversScript: true, ok: true });
  });
});
