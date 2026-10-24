import { describe, expect, it } from 'vitest';
import { getGithubChanges } from '../changeTracker';
import type { GithubRepositoryBaseline } from '../githubTypes';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

const baseline: GithubRepositoryBaseline = {
  owner: 'owner',
  name: 'repo',
  branch: 'main',
  baseCommitSha: 'a'.repeat(40),
  baseTreeSha: 'b'.repeat(40),
  isPrivate: false,
  fileBlobShas: { 'src/file.ts': 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0' },
};

const entries: RoomEntry[] = [
  { id: 'src', name: 'src', parentId: null, isFolder: true },
  { id: 'file', name: 'file.ts', parentId: 'src', isFolder: false },
];

describe('getGithubChanges', () => {
  it('keeps unchanged Git blobs clean and detects edits and new paths', async () => {
    const clean = await getGithubChanges(baseline, entries, () => 'hello');
    expect(clean).toEqual([]);

    const changes = await getGithubChanges(baseline, entries, () => 'changed');
    expect(changes).toEqual([
      { path: 'src/file.ts', content: 'changed', deleted: false, kind: 'modified' },
    ]);
  });

  it('detects deleted baseline paths', async () => {
    const changes = await getGithubChanges(baseline, [], () => '');
    expect(changes).toEqual([
      { path: 'src/file.ts', content: null, deleted: true, kind: 'deleted' },
    ]);
  });

  it('preserves imported line endings when comparing and pushing changes', async () => {
    const windowsBaseline = {
      ...baseline,
      fileBlobShas: {
        'src/file.ts': '2930a14a77931c36554e20b14d9774aef4bf4b78',
      },
      fileLineEndings: { 'src/file.ts': 'crlf' as const },
    };

    expect(
      await getGithubChanges(windowsBaseline, entries, () => 'hello\nworld')
    ).toEqual([]);
    await expect(
      getGithubChanges(windowsBaseline, entries, () => 'changed\nline')
    ).resolves.toEqual([
      {
        path: 'src/file.ts',
        content: 'changed\r\nline',
        deleted: false,
        kind: 'modified',
      },
    ]);
  });
});
