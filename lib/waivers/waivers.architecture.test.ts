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

function waiverSourceFiles(): string[] {
  return walk(WAIVERS_DIR).filter((file) => !/\.test\.ts$/.test(file));
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

const ALLOWED_RUNTIME_IMPORTS = new Set(["lib/fantasy/competition-rank", "lib/db-target-guard"]);
const ALLOWED_TYPE_ONLY_IMPORTS = new Set(["lib/generated/prisma/client"]);

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
    /\.waiverSnapshot(?:Entry|Correction)?\b/.test(source) ||
    /"WaiverSnapshot(?:Entry|Correction)?"/.test(source);
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
    const names = waiverSourceFiles().map((f) => path.basename(f)).sort();
    expect(names).toEqual(
      [
        "board-shape.ts",
        "constants.ts",
        "precision.ts",
        "production.ts",
        "ranking.ts",
        "scoring.ts",
        "script-guard.ts",
      ].sort(),
    );
  });

  it("lib/waivers imports only its allowlist (no Prisma client runtime, no Rankings modules)", () => {
    const violations: string[] = [];
    for (const file of waiverSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const ref of readImports(source)) {
        const target = normalizeSpecifier(file, ref.specifier);
        if (target.startsWith("lib/waivers/")) continue;
        if (ALLOWED_RUNTIME_IMPORTS.has(target)) continue;
        if (ref.typeOnly && ALLOWED_TYPE_ONLY_IMPORTS.has(target)) continue;
        violations.push(`${path.relative(ROOT, file)} -> ${ref.specifier}${ref.typeOnly ? " (type)" : ""}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("pure scoring/precision/shape/production/ranking modules never import the DB guard or DB", () => {
    const pure = ["constants", "precision", "board-shape", "scoring", "production", "ranking"];
    for (const name of pure) {
      const file = path.join(WAIVERS_DIR, `${name}.ts`);
      const imports = readImports(readFileSync(file, "utf8")).map((r) => normalizeSpecifier(file, r.specifier));
      expect(imports.filter((i) => i === "lib/db" || i === "lib/db-target-guard")).toEqual([]);
    }
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

  it("no module outside lib/waivers imports lib/waivers (Phase 1 is unwired)", () => {
    const roots = ["app", "components", "lib", "scripts", "prisma"].map((d) => path.join(ROOT, d));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.startsWith(WAIVERS_DIR + path.sep)) continue;
        if (referencesWaivers(file, readFileSync(file, "utf8"))) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
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
