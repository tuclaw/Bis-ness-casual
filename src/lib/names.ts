const REGIONS = ["us", "eu", "kr", "tw"] as const;
export type Region = (typeof REGIONS)[number];

export interface ParsedName {
  slug: string;
  region: Region | null;
  first: string;
  surname: string;
}

export function parseCharacterQuery(input: string): ParsedName | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter a main name and a surname." };

  const url = trimmed.match(
    /forever\/(us|eu|kr|tw)\/armory\/character\/([a-z0-9]+)(?:-([a-z0-9]+))?(?:\/|$|\?|#)/i,
  );
  if (url?.[1] && url[2]) {
    if (!url[3]) {
      return { error: "That Armory URL is missing the surname. Forever names are two parts." };
    }
    return {
      slug: `${url[2]}-${url[3]}`.toLowerCase(),
      region: url[1].toLowerCase() as Region,
      first: titleCase(url[2]),
      surname: titleCase(url[3]),
    };
  }

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 2) {
    return { error: "Use both names, as in Daz Dingomon. Forever has no realm in the Armory URL." };
  }
  if (parts.length > 2) {
    return { error: "Use the main name and the surname only, with a space between them." };
  }
  return {
    slug: `${parts[0]}-${parts[1]}`,
    region: null,
    first: titleCase(parts[0]!),
    surname: titleCase(parts[1]!),
  };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

export const REGION_ORDER: Region[] = ["us", "eu", "kr", "tw"];
