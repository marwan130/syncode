import { describe, expect, it } from 'vitest';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { ProjectTree, type ProjectTreeOperation } from '../ProjectTree';

const rootFolder: RoomEntry = {
  id: 'folder-root',
  name: 'src',
  parentId: null,
  isFolder: true,
};

function expectSameTree(
  left: ProjectTree,
  right: ProjectTree,
  expected: RoomEntry[]
) {
  expect(left.getEntries()).toEqual(expected);
  expect(right.getEntries()).toEqual(expected);
}

describe('ProjectTree', () => {
  it('merges reordered and duplicate create, rename, move, and delete operations', () => {
    const first = ProjectTree.fromEntries('site-a', []);
    const folder = first.createEntry(rootFolder);
    const file = first.createEntry({
      id: 'file-main',
      name: 'main.ts',
      parentId: rootFolder.id,
      isFolder: false,
    });
    const rename = first.renameEntry('file-main', 'index.ts');
    const move = first.moveEntry('file-main', null);
    const second = ProjectTree.fromEntries('site-b', []);
    const remove = second.deleteEntry(rootFolder.id);
    const operations = [folder, file, rename, move, remove];

    const left = ProjectTree.fromEntries('left', []);
    const right = ProjectTree.fromEntries('right', []);
    for (const operation of operations) left.applyOperation(operation);
    for (const operation of [...operations].reverse()) {
      right.applyOperation(operation);
      right.applyOperation(operation);
    }

    expectSameTree(left, right, [
      { id: 'file-main', name: 'index.ts', parentId: null, isFolder: false },
    ]);
  });

  it('uses Lamport time and site ID to resolve concurrent renames', () => {
    const base = ProjectTree.fromEntries('base', [
      { id: 'file', name: 'start.ts', parentId: null, isFolder: false },
    ]);
    const left = new ProjectTree('site-a');
    const right = new ProjectTree('site-b');
    left.fromSnapshot(base.toSnapshot());
    right.fromSnapshot(base.toSnapshot());
    const renameA = left.renameEntry('file', 'alpha.ts');
    const renameB = right.renameEntry('file', 'beta.ts');

    const first = new ProjectTree('first');
    const second = new ProjectTree('second');
    first.fromSnapshot(base.toSnapshot());
    second.fromSnapshot(base.toSnapshot());
    first.applyOperation(renameA);
    first.applyOperation(renameB);
    second.applyOperation(renameB);
    second.applyOperation(renameA);

    expectSameTree(first, second, [
      { id: 'file', name: 'beta.ts', parentId: null, isFolder: false },
    ]);
  });

  it('keeps deletion permanent when rename or move operations arrive later', () => {
    const base = ProjectTree.fromEntries('base', [rootFolder]);
    const editor = new ProjectTree('editor');
    editor.fromSnapshot(base.toSnapshot());
    const rename = editor.renameEntry(rootFolder.id, 'renamed');
    const move = editor.moveEntry(rootFolder.id, null);
    const deletion = new ProjectTree('deleter').deleteEntry(rootFolder.id);
    const operations: ProjectTreeOperation[] = [rename, move, deletion];

    const first = ProjectTree.fromEntries('first', [rootFolder]);
    const second = ProjectTree.fromEntries('second', [rootFolder]);
    for (const operation of operations) first.applyOperation(operation);
    for (const operation of [...operations].reverse())
      second.applyOperation(operation);

    expectSameTree(first, second, []);
  });

  it('breaks concurrent moves that form a cycle deterministically', () => {
    const baseEntries: RoomEntry[] = [
      { id: 'folder-a', name: 'a', parentId: null, isFolder: true },
      { id: 'folder-b', name: 'b', parentId: null, isFolder: true },
    ];
    const base = ProjectTree.fromEntries('base', baseEntries);
    const siteA = new ProjectTree('site-a');
    const siteB = new ProjectTree('site-b');
    siteA.fromSnapshot(base.toSnapshot());
    siteB.fromSnapshot(base.toSnapshot());
    const moveA = siteA.moveEntry('folder-a', 'folder-b');
    const moveB = siteB.moveEntry('folder-b', 'folder-a');

    const left = new ProjectTree('left');
    const right = new ProjectTree('right');
    left.fromSnapshot(base.toSnapshot());
    right.fromSnapshot(base.toSnapshot());
    left.applyOperation(moveA);
    left.applyOperation(moveB);
    right.applyOperation(moveB);
    right.applyOperation(moveA);

    expectSameTree(left, right, [
      { id: 'folder-a', name: 'a', parentId: null, isFolder: true },
      { id: 'folder-b', name: 'b', parentId: 'folder-a', isFolder: true },
    ]);
  });

  it('restores and merges snapshots without losing duplicate-delivery safety', () => {
    const original = ProjectTree.fromEntries('site-a', [rootFolder]);
    const created = original.createEntry({
      id: 'file',
      name: 'app.ts',
      parentId: rootFolder.id,
      isFolder: false,
    });
    const restored = new ProjectTree('site-b');
    restored.fromSnapshot(original.toSnapshot());
    restored.applyOperation(created);

    expect(restored.getEntries()).toEqual([
      { id: 'file', name: 'app.ts', parentId: rootFolder.id, isFolder: false },
      rootFolder,
    ]);
    expect(restored.toSnapshot()).toBe(original.toSnapshot());
  });

  it('compacts superseded edits while preserving the visible tree state', () => {
    const tree = ProjectTree.fromEntries('base', [rootFolder]);
    for (let index = 0; index < 20; index += 1) {
      tree.renameEntry(rootFolder.id, `src-${index}`);
    }

    const snapshot = tree.toSnapshot();
    const restored = ProjectTree.fromEntries('restored', [rootFolder]);
    restored.fromSnapshot(snapshot);

    expect(JSON.parse(snapshot).operations).toHaveLength(2);
    expect(restored.getEntries()).toEqual([{ ...rootFolder, name: 'src-19' }]);
  });

  it('preserves deleted entries and current parent registers in compacted snapshots', () => {
    const tree = ProjectTree.fromEntries('site-a', [rootFolder]);
    tree.createEntry({
      id: 'file',
      name: 'main.ts',
      parentId: rootFolder.id,
      isFolder: false,
    });
    tree.moveEntry('file', null);
    tree.deleteEntry('file');

    const restored = ProjectTree.fromEntries('site-b', [rootFolder]);
    restored.fromSnapshot(tree.toSnapshot());

    expect(restored.getEntries()).toEqual([rootFolder]);
    expect(restored.toSnapshot()).toBe(tree.toSnapshot());
  });

  it('deletes folder descendants while preserving children moved out of the folder', () => {
    const tree = ProjectTree.fromEntries('site-a', [rootFolder]);
    tree.createEntry({
      id: 'nested',
      name: 'nested',
      parentId: rootFolder.id,
      isFolder: true,
    });
    tree.createEntry({
      id: 'inside',
      name: 'inside.ts',
      parentId: 'nested',
      isFolder: false,
    });
    tree.createEntry({
      id: 'moved',
      name: 'moved.ts',
      parentId: 'nested',
      isFolder: false,
    });
    tree.moveEntry('moved', null);
    tree.deleteEntry(rootFolder.id);

    expect(tree.getEntries()).toEqual([
      { id: 'moved', name: 'moved.ts', parentId: null, isFolder: false },
    ]);
  });

  it('rejects reuse of an operation ID with different content', () => {
    const tree = new ProjectTree('site-a');
    tree.createEntry(rootFolder);

    expect(() =>
      tree.applyOperation({
        type: 'create',
        opId: { siteId: 'site-a', counter: 1 },
        entry: { ...rootFolder, name: 'other' },
      })
    ).toThrow('Conflicting project tree operation ID.');
  });
});
