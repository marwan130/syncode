export function projectFileListViewportHeight(itemCount: number): number {
  return Math.min(380, Math.max(1, itemCount) * 28 + 16);
}
