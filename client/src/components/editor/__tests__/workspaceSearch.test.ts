import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_OPTIONS,
  findWorkspaceMatches,
  groupSearchMatches,
  highlightSearchLine,
  replaceMatchInText,
} from '../workspaceSearch';
import type { RoomEntry } from '../../../providers/SignalRCrdtProvider';

const files: RoomEntry[] = [
  {
    id: 'a',
    name: 'main.cpp',
    parentId: null,
    isFolder: false,
  },
  {
    id: 'b',
    name: 'readme.md',
    parentId: null,
    isFolder: false,
  },
];

describe('workspace search', () => {
  it('groups matches by file and highlights the query', () => {
    const provider = {
      getFileContent(id: string) {
        return id === 'a'
          ? 'int main() {\n  return 0;\n}'
          : '# main notes\nSee main.cpp';
      },
    };
    const matches = findWorkspaceMatches(files, 'main', provider as never);
    expect(matches.map((match) => `${match.path}:${match.line}`)).toEqual([
      'main.cpp:1',
      'readme.md:1',
      'readme.md:2',
    ]);
    const groups = groupSearchMatches(matches);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      name: 'main.cpp',
      parentPath: '',
    });
    expect(groups[1].matches).toHaveLength(2);
    expect(highlightSearchLine('See main.cpp', 'main')).toEqual([
      { text: 'See ', match: false },
      { text: 'main', match: true },
      { text: '.cpp', match: false },
    ]);
  });

  it('replaces only the selected match and preserves the original line on stale positions', () => {
    expect(
      replaceMatchInText('foo foo', 'foo', 'bar', DEFAULT_SEARCH_OPTIONS, 1, 5)
    ).toBe('foo bar');
    expect(
      replaceMatchInText('foo foo', 'foo', 'bar', DEFAULT_SEARCH_OPTIONS, 1, 20)
    ).toBe('bar bar');
  });

  it('applies preserve-case to a selected replacement', () => {
    expect(
      replaceMatchInText(
        'FOO foo',
        'foo',
        'bar',
        { ...DEFAULT_SEARCH_OPTIONS, preserveCase: true },
        1,
        1
      )
    ).toBe('BAR foo');
  });
});
