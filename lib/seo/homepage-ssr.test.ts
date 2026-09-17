import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeEntityIntro } from "@/components/home/HomeEntityIntro";
import {
  PUBLIC_BRAND_DEFINITION,
  PUBLIC_BRAND_NAME,
} from "@/lib/brand";
import {
  COMPANY_LEGAL_NAME,
  HOMEPAGE_NOT_INVESTMENT_NOTE,
} from "@/lib/company";

describe("homepage server-rendered entity intro", () => {
  it("includes RankEyeQ H1 and fantasy-football definition without client JS", () => {
    const html = renderToStaticMarkup(createElement(HomeEntityIntro));
    expect(html).toContain("<h1");
    expect(html).toContain(PUBLIC_BRAND_NAME);
    expect(html).toContain(PUBLIC_BRAND_DEFINITION);
    expect(html).toMatch(/quarterbacks|QBs/i);
    expect(html).toMatch(/running backs|RBs/i);
    expect(html).toMatch(/fantasy-point finishes/i);
    expect(html).toContain(COMPANY_LEGAL_NAME);
    expect(html).toContain(HOMEPAGE_NOT_INVESTMENT_NOTE);
    expect(html).not.toMatch(/Rank Equity/i);
    expect(html).not.toMatch(/Loading RankEyeQ home/i);
  });

  it("homepage page module no longer awaits data before returning static shell", () => {
    const source = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    expect(source).toContain("HomeEntityIntro");
    expect(source).toContain("Suspense");
    expect(source).not.toMatch(/export const dynamic = ["']force-dynamic["']/);
    expect(source).not.toMatch(/export default async function HomePage/);
  });

  it("does not ship a root loading shell that replaces homepage HTML", () => {
    expect(() =>
      readFileSync(join(process.cwd(), "app/loading.tsx"), "utf8"),
    ).toThrow();
  });
});
