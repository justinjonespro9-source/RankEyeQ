import type { Metadata } from "next";

export const NO_INDEX: Pick<Metadata, "robots"> = {
  robots: { index: false, follow: false },
};

export const PUBLIC_INDEX: Pick<Metadata, "robots"> = {
  robots: { index: true, follow: true },
};

export function canonicalMetadata(path: string): Pick<Metadata, "alternates"> {
  const base = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
  if (!base) return {};
  return {
    alternates: {
      canonical: `${base}${path.startsWith("/") ? path : `/${path}`}`,
    },
  };
}

export function privatePageMetadata(
  title: string,
  description: string,
): Metadata {
  return {
    title,
    description,
    ...NO_INDEX,
  };
}
