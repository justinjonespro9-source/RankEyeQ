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
  "artifacts/errors",
  "artifacts/authority",
  "artifacts/import-model",
  "artifacts/upload-limits",
  "results/fingerprints",
  "results/model",
  "play-model",
  "consensus-model",
  "leaderboard-model",
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
  "artifacts/import",
  "artifacts/withdraw",
  "artifacts/queries",
  "artifacts/actions",
  "artifacts/upload",
  "play-queries",
  "leaderboard-queries",
];
const ACTION_MODULES = ["actions", "snapshot/actions", "artifacts/actions"];

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
  "node:zlib",
]);
/** The admin UI allowed to import Waivers, and what it may import at runtime. */
const WAIVERS_UI_DIRS = ["app/admin/waivers", "components/admin/waivers"];
const WAIVERS_UI_RUNTIME_IMPORTS = new Set([
  "lib/waivers/actions",
  "lib/waivers/snapshot/actions",
  "lib/waivers/snapshot/queries",
  "lib/waivers/artifacts/actions",
  "lib/waivers/artifacts/queries",
  "lib/waivers/artifacts/authority",
  "lib/waivers/artifacts/upload-limits",
  "lib/waivers/constants",
]);
/** The canonical artifact upload route handlers: thin wrappers over the upload service only. */
const ARTIFACT_UPLOAD_ROUTE_DIR = "app/api/admin/waivers/artifacts";
const ARTIFACT_UPLOAD_ROUTE_RUNTIME_IMPORTS = new Set(["lib/waivers/artifacts/upload"]);
/**
 * The public play surface: board actions, pure display models, and the public
 * read model (server page only). Never snapshot/admin modules or raw services.
 */
const PUBLIC_WAIVERS_UI_DIRS = ["app/waivers", "components/waivers"];
const PUBLIC_WAIVERS_UI_RUNTIME_IMPORTS = new Set([
  "lib/waivers/actions",
  "lib/waivers/constants",
  "lib/waivers/play-model",
  "lib/waivers/consensus-model",
  "lib/waivers/play-queries",
]);
/**
 * The shared leaderboard experience (Rankings | Waivers): the read-only
 * leaderboard queries from the server page, and the pure leaderboard model.
 */
const LEADERBOARD_WAIVERS_UI_RUNTIME_IMPORTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "app/leaderboards": new Set(["lib/waivers/leaderboard-model", "lib/waivers/leaderboard-queries"]),
  "components/leaderboards": new Set(["lib/waivers/leaderboard-model"]),
};
const QUERY_MODULES = new Set([
  "lib/waivers/snapshot/queries",
  "lib/waivers/artifacts/queries",
  "lib/waivers/play-queries",
  "lib/waivers/leaderboard-queries",
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

/** Stage 4B.3 results and grading storage delegates (models minus the "Waiver" prefix). */
const RESULTS_STORAGE_STEMS = [
  "ConflictResolution",
  "ContestResult",
  "PoolResult",
  "GradeRun",
  "BoardGrade",
  "CallGrade",
  "GradeApproval",
  "GradeAuthorityChange",
  "WeekGradeAuthority",
  "ContestResultAuthority",
  "BoardGradeAuthority",
];
const WAIVER_DELEGATE_STEMS = [
  "Snapshot(?:Entry|Correction)?",
  "Contest",
  "Submission(?:Revision)?",
  "Call",
  "CanonicalArtifact(?:Content|Event)?",
  ...RESULTS_STORAGE_STEMS,
].join("|");

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
    new RegExp(`\\.waiver(?:${WAIVER_DELEGATE_STEMS})\\b`).test(source) ||
    new RegExp(`"Waiver(?:${WAIVER_DELEGATE_STEMS})"`).test(source);
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
      const isActions = ACTION_MODULES.includes(moduleName(file));
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

  it("artifact authority modules never grade, score, contact SNG, or write anything but artifact records and the audit log", () => {
    const offenders: string[] = [];
    const bannedTargets = /^lib\/waivers\/(?:scoring|production|ranking|contests|submissions|corrections|play-|leaderboard-|consensus-model|snapshot\/(?:freeze|correct)|canonical\/preflight)/;
    const writable = new Set(["waiverCanonicalArtifact", "waiverCanonicalArtifactContent", "waiverCanonicalArtifactEvent", "adminAuditLog"]);
    for (const file of waiverSourceFiles().filter((f) => moduleName(f).startsWith("artifacts/"))) {
      const source = readFileSync(file, "utf8");
      const rel = path.relative(ROOT, file);
      for (const ref of readImports(source)) {
        if (bannedTargets.test(normalizeSpecifier(file, ref.specifier))) offenders.push(`${rel} -> ${ref.specifier}`);
      }
      for (const match of source.matchAll(/\b\w+\s*\.\s*(\w+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g)) {
        if (!writable.has(match[1]) || match[2] !== "create") offenders.push(`${rel}: ${match[1]}.${match[2]}`);
      }
      for (const banned of [/\$executeRaw/, /\bfetch\s*\(/, /https?:\/\//, /\bconsole\.\w+\s*\(/, /\bgrade[A-Z]\w*\s*\(/, /scoreWaiverBoard|computeWaiverProduction/]) {
        if (banned.test(source)) offenders.push(`${rel}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("results and grading storage is not written by any application code yet (no grading workflow in Stage 4B.3)", () => {
    const delegates = RESULTS_STORAGE_STEMS.map((stem) => `waiver${stem}`).join("|");
    const write = new RegExp(`\\.\\s*(?:${delegates})\\s*\\.\\s*(?:create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\\s*\\(`);
    const rawWrite = new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE)\\s+"Waiver(?:${RESULTS_STORAGE_STEMS.join("|")})"`, "i");
    const offenders: string[] = [];
    for (const root of ["app", "components", "lib", "scripts"].map((d) => path.join(ROOT, d))) {
      for (const file of walk(root)) {
        if (/\.test\.ts$/.test(file) || file.startsWith(FIXTURES_DIR + path.sep)) continue;
        const source = readFileSync(file, "utf8");
        if (write.test(source) || rawWrite.test(source)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("results modules stay pure: no scoring of boards, no DB, no SNG contact", () => {
    for (const name of ["results/fingerprints", "results/model"]) {
      const source = readFileSync(path.join(WAIVERS_DIR, `${name}.ts`), "utf8");
      for (const banned of [/\$(?:executeRaw|queryRaw|transaction)/, /\bfetch\s*\(/, /https?:\/\//, /scoreWaiverBoard|evaluateCanonicalWaiverBoard/]) {
        expect(source, `${name}: ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("artifact text is read only by the importer and the content re-verifier, never by UI code", () => {
    const readers: string[] = [];
    for (const root of ["app", "components", "lib"].map((d) => path.join(ROOT, d))) {
      for (const file of walk(root)) {
        if (/\.test\.ts$/.test(file) || file.startsWith(FIXTURES_DIR + path.sep) || file.includes(`${path.sep}generated${path.sep}`)) continue;
        if (/waiverCanonicalArtifactContent|contentText/.test(readFileSync(file, "utf8"))) readers.push(path.relative(ROOT, file).split(path.sep).join("/"));
      }
    }
    expect(readers.sort()).toEqual(["lib/waivers/artifacts/import.ts", "lib/waivers/artifacts/queries.ts"]);
    const queries = readFileSync(path.join(WAIVERS_DIR, "artifacts/queries.ts"), "utf8");
    const reverifier = queries.indexOf("export async function reverifyWaiverArtifactContent");
    expect(reverifier).toBeGreaterThan(0);
    expect(queries.slice(0, reverifier)).not.toMatch(/contentText|content:\s*\{/);
  });

  it("artifact text arrives only through the authenticated upload routes, never a Server Action", () => {
    expect(readFileSync(path.join(WAIVERS_DIR, "artifacts/actions.ts"), "utf8")).not.toMatch(/artifactText|previewWaiverArtifactImport|applyWaiverArtifactImport/);
    const routes = walk(path.join(ROOT, ARTIFACT_UPLOAD_ROUTE_DIR)).map((file) => path.relative(ROOT, file).split(path.sep).join("/")).sort();
    expect(routes).toEqual([`${ARTIFACT_UPLOAD_ROUTE_DIR}/import/route.ts`, `${ARTIFACT_UPLOAD_ROUTE_DIR}/preview/route.ts`]);
    for (const route of routes) {
      const source = readFileSync(path.join(ROOT, route), "utf8");
      expect([...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1])).toEqual(["POST"]);
      expect(source).toMatch(/return handleWaiverArtifactUpload\(request, "(preview|import)"\);/);
    }
    const upload = readFileSync(path.join(WAIVERS_DIR, "artifacts/upload.ts"), "utf8");
    expect(upload).toMatch(/maxOutputLength/);
    expect(upload.indexOf("resolveAdminUserId()")).toBeLessThan(upload.indexOf("readCappedBody(request"));
  });

  it("admin artifact surfaces carry the operator-trust label and never claim the checksum authenticates SNG", () => {
    const surfaces = [
      "app/admin/waivers/artifacts/page.tsx",
      "app/admin/waivers/artifacts/[artifactRowId]/page.tsx",
      "components/admin/waivers/WaiverArtifactImportPanel.tsx",
    ];
    for (const rel of surfaces) expect(readFileSync(path.join(ROOT, rel), "utf8"), rel).toContain("WAIVER_ARTIFACT_AUTHORITY_LABEL");
    const claims =
      /cryptographic(?:ally)? (?:verified|authenticated|signed)|signed by SNG|SNG[- ]signed|checksum (?:proves|establishes|authenticates) (?:the )?(?:author|publish|publication|SNG)|verified publication/i;
    for (const dir of WAIVERS_UI_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) expect(readFileSync(file, "utf8"), path.relative(ROOT, file)).not.toMatch(claims);
    }
    expect(readFileSync(path.join(WAIVERS_DIR, "artifacts/authority.ts"), "utf8")).not.toMatch(claims);
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

  it("only the admin, public Waivers and leaderboard UIs import lib/waivers, each from its own runtime allowlist", () => {
    const roots = ["app", "components", "lib", "scripts", "prisma"].map((d) => path.join(ROOT, d));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.startsWith(WAIVERS_DIR + path.sep)) continue;
        const source = readFileSync(file, "utf8");
        if (!referencesWaivers(file, source)) continue;
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        const isAdminUi = WAIVERS_UI_DIRS.some((dir) => rel.startsWith(`${dir}/`));
        const isPublicUi = PUBLIC_WAIVERS_UI_DIRS.some((dir) => rel.startsWith(`${dir}/`));
        const leaderboardDir = Object.keys(LEADERBOARD_WAIVERS_UI_RUNTIME_IMPORTS).find((dir) => rel.startsWith(`${dir}/`));
        const isUploadRoute = rel.startsWith(`${ARTIFACT_UPLOAD_ROUTE_DIR}/`);
        if (!isAdminUi && !isPublicUi && !leaderboardDir && !isUploadRoute) {
          offenders.push(rel);
          continue;
        }
        const allowed = isAdminUi
          ? WAIVERS_UI_RUNTIME_IMPORTS
          : isPublicUi
            ? PUBLIC_WAIVERS_UI_RUNTIME_IMPORTS
            : isUploadRoute
              ? ARTIFACT_UPLOAD_ROUTE_RUNTIME_IMPORTS
              : LEADERBOARD_WAIVERS_UI_RUNTIME_IMPORTS[leaderboardDir!];
        for (const ref of readImports(source)) {
          const target = normalizeSpecifier(file, ref.specifier);
          if (!target.startsWith("lib/waivers") || ref.typeOnly) continue;
          if (!allowed.has(target)) offenders.push(`${rel} -> ${ref.specifier}`);
          if (QUERY_MODULES.has(target) && !rel.startsWith("app/")) {
            offenders.push(`${rel} -> queries outside a server page`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Waivers leaderboard read path never writes, grades, or stamps locks", () => {
    const offenders: string[] = [];
    for (const name of ["leaderboard-queries", "leaderboard-model"]) {
      const source = readFileSync(path.join(WAIVERS_DIR, `${name}.ts`), "utf8");
      for (const banned of [
        /\b\w+\s*\.\s*\w+\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
        /\$(?:executeRaw|transaction)/,
        /\b(?:scoreWaiverBoard|computeWaiverProduction|exclusiveLockWaiver\w*|stampWaiver\w*|loadFinalWaiverBoards|loadCurrentWaiverBoards)\s*\(/,
      ]) {
        if (banned.test(source)) offenders.push(`${name}.ts: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the public play surface never calls the admin opening action or reads admin notes", () => {
    const offenders: string[] = [];
    for (const dir of PUBLIC_WAIVERS_UI_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        for (const banned of [/openWaiverContestsAction/, /adminNotes/, /exclusionNote/, /correctionReason/, /\binputLine\b/]) {
          if (banned.test(source)) offenders.push(`${path.relative(ROOT, file)}: ${banned}`);
        }
      }
    }
    const queries = readFileSync(path.join(WAIVERS_DIR, "play-queries.ts"), "utf8");
    for (const banned of [/adminNotes/, /exclusionNote/, /correctionReason/, /\binputLine\b/, /sourceUrl/]) {
      if (banned.test(queries)) offenders.push(`play-queries.ts: ${banned}`);
    }
    expect(offenders).toEqual([]);
  });

  it("Waivers routes exist only under /admin, the admin artifact upload API, and the single public /waivers page; admin links stay admin-only", () => {
    const routeDirs = walk(path.join(ROOT, "app"))
      .map((file) => path.relative(ROOT, path.dirname(file)).split(path.sep).join("/"))
      .filter((dir) => /(^|\/)waivers(\/|$)/i.test(dir));
    expect(
      routeDirs.filter((dir) => !dir.startsWith("app/admin/waivers") && !dir.startsWith(`${ARTIFACT_UPLOAD_ROUTE_DIR}/`) && dir !== "app/waivers"),
    ).toEqual([]);
    expect(routeDirs).toContain("app/waivers");
    const linkers: string[] = [];
    for (const root of ["app", "components", "lib"].map((d) => path.join(ROOT, d))) {
      for (const file of walk(root)) {
        if (/\.test\.ts$/.test(file)) continue;
        if (/["'`]\/admin\/waivers/.test(readFileSync(file, "utf8"))) linkers.push(path.relative(ROOT, file).split(path.sep).join("/"));
      }
    }
    const allowed = ["lib/admin/admin-nav.ts", "lib/waivers/snapshot/actions.ts", "lib/waivers/artifacts/actions.ts", ...WAIVERS_UI_DIRS];
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

  it("flags a script that touches Stage 4B.3 results or grading delegates without the guard", () => {
    for (const delegate of ["waiverContestResult", "waiverGradeRun", "waiverBoardGradeAuthority", "waiverGradeAuthorityChange"]) {
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
