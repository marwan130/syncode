import { describe, expect, it } from 'vitest';
import {
  INITIAL_EDITOR_GROUP,
  openEditorGroupFile,
  removeEditorGroup,
  resizeEditorGroupBoundary,
  splitEditorGroup,
} from '../editorGroups';

describe('editor groups', () => {
  it('splits the selected group repeatedly into independent panes', () => {
    const second = splitEditorGroup(
      [INITIAL_EDITOR_GROUP],
      'group-1',
      'group-2'
    );
    const third = splitEditorGroup(second, 'group-1', 'group-3');

    expect(third.map(({ id, width }) => ({ id, width }))).toEqual([
      { id: 'group-1', width: 25 },
      { id: 'group-3', width: 25 },
      { id: 'group-2', width: 50 },
    ]);
  });

  it('moves a file to the selected group without duplicate tabs', () => {
    const groups = splitEditorGroup(
      [INITIAL_EDITOR_GROUP],
      'group-1',
      'group-2'
    );
    const openedInFirst = openEditorGroupFile(groups, 'group-1', 'file-a');
    const openedInSecond = openEditorGroupFile(
      openedInFirst,
      'group-2',
      'file-a'
    );

    expect(openedInSecond[0].fileIds).toEqual([]);
    expect(openedInSecond[1].fileIds).toEqual(['file-a']);
    expect(openedInSecond[1].activeFileId).toBe('file-a');
  });

  it('resizes adjacent groups without changing their combined width', () => {
    const groups = splitEditorGroup(
      [INITIAL_EDITOR_GROUP],
      'group-1',
      'group-2'
    );
    const resized = resizeEditorGroupBoundary(groups, 'group-1', 10);

    expect(resized.map(({ width }) => width)).toEqual([60, 40]);
    expect(resized.reduce((sum, group) => sum + group.width, 0)).toBe(100);
  });

  it('merges tabs and available width when a group closes', () => {
    const groups = splitEditorGroup(
      [INITIAL_EDITOR_GROUP],
      'group-1',
      'group-2'
    );
    const withFiles = openEditorGroupFile(
      openEditorGroupFile(groups, 'group-1', 'file-a'),
      'group-2',
      'file-b'
    );
    const result = removeEditorGroup(withFiles, 'group-2');

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].fileIds).toEqual(['file-a', 'file-b']);
    expect(result.groups[0].width).toBe(100);
    expect(result.activeGroupId).toBe('group-1');
  });
});
