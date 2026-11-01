import { describe, expect, it } from 'vitest';
import type {
  GithubBranchOption,
  GithubCommitHistoryItem,
} from '../../../github/repositoryBrowser';
import {
  buildScmHistoryGraphRows,
  getScmHistoryGraphPaths,
} from '../scmHistoryGraph';

const history: GithubCommitHistoryItem[] = [
  {
    sha: 'merge',
    message: 'merge feature',
    author: 'user',
    date: null,
    parents: ['main-parent', 'feature-parent'],
  },
  {
    sha: 'main-parent',
    message: 'main change',
    author: 'user',
    date: null,
    parents: ['root'],
  },
  {
    sha: 'feature-parent',
    message: 'feature change',
    author: 'user',
    date: null,
    parents: ['root'],
  },
  { sha: 'root', message: 'root', author: 'user', date: null, parents: [] },
];

const branches: GithubBranchOption[] = [
  { name: 'main', sha: 'merge', isProtected: true },
  { name: 'feature', sha: 'feature-parent', isProtected: false },
];

describe('SCM history graph rows', () => {
  it('keeps first-parent and merge-parent lanes connected through the graph', () => {
    const rows = buildScmHistoryGraphRows(history, branches, 'main', [
      'main-color',
      'feature-color',
    ]);

    expect(rows.map((row) => row.outputLanes)).toEqual([
      [
        { id: 'main-parent', color: 'main-color' },
        { id: 'feature-parent', color: 'feature-color' },
      ],
      [
        { id: 'root', color: 'main-color' },
        { id: 'feature-parent', color: 'feature-color' },
      ],
      [
        { id: 'root', color: 'main-color' },
        { id: 'root', color: 'feature-color' },
      ],
      [],
    ]);
    expect(rows.map((row) => row.isHead)).toEqual([true, false, false, false]);
  });

  it('renders a merge edge using the merged parent lane color', () => {
    const rows = buildScmHistoryGraphRows(history, branches, 'main', [
      'main-color',
      'feature-color',
    ]);

    expect(getScmHistoryGraphPaths(rows[0])).toContainEqual(
      expect.objectContaining({ key: 'merge-1', color: 'feature-color' })
    );
  });
});
