export const ENTER_KEY = "bis-ness-casual-entered";
export const SELECT_HASH = "#select";

function bareHash(hash: string): string {
  return hash.replace(/^#\/?/, "");
}

/** First visit to the bare site, or an explicit return via #select. Other hashes skip it. */
export function shouldShowLineup(hash: string, stored: string | null): boolean {
  const bare = bareHash(hash);
  if (bare === "select") return true;
  if (bare) return false;
  return stored !== "1";
}

/** Leaving #select pushes #gear so Back returns to the lineup. The first visit replaces the empty hash. */
export function lineupExit(hash: string): "replace" | "push" | "keep" {
  const bare = bareHash(hash);
  if (!bare) return "replace";
  if (bare === "select") return "push";
  return "keep";
}

/** `#c/us:sir-stackers` selects that saved profile. Other hashes do not. */
export function characterKeyFromHash(hash: string): string | null {
  const bare = hash.replace(/^#\/?/, "");
  const match = /^c\/([a-z0-9]+):([a-z0-9-]+)$/.exec(bare);
  return match ? `${match[1]}:${match[2]}` : null;
}
