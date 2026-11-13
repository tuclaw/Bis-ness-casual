import { sourceLabel } from "./lib/sources.ts";

/** The source line rendered on recommendation rows, dungeon items, and item tooltips. */
export function SourceNote({ source }: { source?: string }) {
  return <span className="source-note">{sourceLabel(source)}</span>;
}
