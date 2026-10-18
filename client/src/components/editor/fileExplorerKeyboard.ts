export type ExplorerNavigationAction =
  | 'first'
  | 'last'
  | 'next'
  | 'previous'
  | 'expand'
  | 'collapse'
  | 'focus-next'
  | 'focus-parent';

export function getExplorerNavigationAction(
  key: string,
  isFolder: boolean,
  isExpanded: boolean,
  depth: number
): ExplorerNavigationAction | null {
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'previous';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if (key === 'ArrowRight' && isFolder)
    return isExpanded ? 'focus-next' : 'expand';
  if (key === 'ArrowLeft' && isFolder && isExpanded) return 'collapse';
  if (key === 'ArrowLeft' && depth > 0) return 'focus-parent';
  return null;
}
