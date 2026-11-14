/** One open tooltip. Tapping the same item closes it; tapping another swaps to that item. */
export function nextOpenTip(current: string | null, tapped: string): string | null {
  return current === tapped ? null : tapped;
}

export function placeTooltip(box: {
  hostTop: number;
  hostBottom: number;
  hostLeft: number;
  tipWidth: number;
  tipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): { left: number; top: number; maxHeight: number } {
  const margin = 8;
  const maxHeight = Math.max(120, box.viewportHeight - margin * 2);
  const width = Math.min(box.tipWidth, Math.max(0, box.viewportWidth - margin * 2));
  const left = Math.max(margin, Math.min(box.hostLeft, box.viewportWidth - width - margin));
  const height = Math.min(box.tipHeight, maxHeight);
  let top = box.hostBottom + 6;
  if (top + height > box.viewportHeight - margin) {
    const above = box.hostTop - height - 6;
    top = above >= margin ? above : margin;
  }
  return { left, top, maxHeight };
}
