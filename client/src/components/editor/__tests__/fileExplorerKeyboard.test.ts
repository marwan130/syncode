import { describe, expect, it } from 'vitest';
import { getExplorerNavigationAction } from '../fileExplorerKeyboard';

describe('file explorer keyboard navigation', () => {
  it.each([
    ['ArrowDown', false, false, 0, 'next'],
    ['ArrowUp', false, false, 0, 'previous'],
    ['Home', false, false, 0, 'first'],
    ['End', false, false, 0, 'last'],
    ['ArrowRight', true, false, 0, 'expand'],
    ['ArrowRight', true, true, 0, 'focus-next'],
    ['ArrowLeft', true, true, 0, 'collapse'],
    ['ArrowLeft', false, false, 2, 'focus-parent'],
  ])('maps %s to %s', (key, folder, expanded, depth, action) => {
    expect(getExplorerNavigationAction(key, folder, expanded, depth)).toBe(
      action
    );
  });

  it('does not navigate to a parent at the root or expand files', () => {
    expect(
      getExplorerNavigationAction('ArrowLeft', false, false, 0)
    ).toBeNull();
    expect(
      getExplorerNavigationAction('ArrowRight', false, false, 1)
    ).toBeNull();
    expect(getExplorerNavigationAction('Enter', false, false, 1)).toBeNull();
  });
});
