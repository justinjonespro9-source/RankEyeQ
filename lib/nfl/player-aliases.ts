import { playerNamesCanMerge } from "@/lib/nfl/player-identity";

const ALIAS_PREFIX = "@aliases:";

export function parsePlayerAliases(adminNotes: string | null | undefined): string[] {
  if (!adminNotes) return [];
  const line = adminNotes
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith(ALIAS_PREFIX));
  if (!line) return [];
  const raw = line.slice(ALIAS_PREFIX.length).trim();
  if (!raw) return [];
  return raw
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function formatAliasesInAdminNotes(
  adminNotes: string | null | undefined,
  aliases: string[],
): string {
  const withoutAliasLine = (adminNotes ?? "")
    .split("\n")
    .filter((row) => !row.trim().startsWith(ALIAS_PREFIX))
    .join("\n")
    .trim();
  const unique = [...new Set(aliases.map((value) => value.trim()).filter(Boolean))];
  const aliasLine =
    unique.length > 0 ? `${ALIAS_PREFIX}${unique.join("|")}` : "";
  if (!withoutAliasLine) return aliasLine;
  if (!aliasLine) return withoutAliasLine;
  return `${withoutAliasLine}\n${aliasLine}`;
}

export function addPlayerAliases(
  adminNotes: string | null | undefined,
  aliases: string[],
): string {
  const existing = parsePlayerAliases(adminNotes);
  return formatAliasesInAdminNotes(adminNotes, [...existing, ...aliases]);
}

export function rankableEntryMatchesImportName(
  entry: { name: string; adminNotes?: string | null },
  importName: string,
): boolean {
  if (playerNamesCanMerge(entry.name, importName)) return true;
  const aliases = parsePlayerAliases(entry.adminNotes);
  return aliases.some(
    (alias) =>
      alias === importName || playerNamesCanMerge(alias, importName),
  );
}

export function parserEntryMatchesRawName(
  entry: { name: string; aliases?: string[] | null },
  rawName: string,
): boolean {
  if (rankableEntryMatchesImportName(entry, rawName)) return true;
  for (const alias of entry.aliases ?? []) {
    if (rankableEntryMatchesImportName({ name: alias }, rawName)) return true;
  }
  return false;
}
