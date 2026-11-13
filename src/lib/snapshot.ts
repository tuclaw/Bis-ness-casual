import type { SavedProfile } from "./types.ts";

/** Compare snapshots without the fetch clock, so an unchanged Armory does not commit. */
export function snapshotSignature(profiles: SavedProfile[]): string {
  return JSON.stringify(
    profiles.map((profile) => {
      const { fetchedAt: _fetchedAt, ...rest } = profile;
      return rest;
    }),
  );
}

export function snapshotChanged(before: SavedProfile[], after: SavedProfile[]): boolean {
  return snapshotSignature(before) !== snapshotSignature(after);
}
