export const ENTER_KEY = "bis-ness-casual-entered";

/** The lineup is only the first visit to the bare site. Any hash, including a character or #questing, skips it. */
export function shouldShowLineup(hash: string, stored: string | null): boolean {
  if (hash.replace(/^#\/?/, "")) return false;
  return stored !== "1";
}

/** `#c/us:sir-stackers` selects that saved profile. Other hashes do not. */
export function characterKeyFromHash(hash: string): string | null {
  const bare = hash.replace(/^#\/?/, "");
  const match = /^c\/([a-z0-9]+):([a-z0-9-]+)$/.exec(bare);
  return match ? `${match[1]}:${match[2]}` : null;
}
