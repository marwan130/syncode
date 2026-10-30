import { describe, expect, it } from 'vitest';
import { getProjectEntryPath, isSharedProjectPath } from '../projectPathRules';

describe('project path rules', () => {
  it('accepts ordinary nested source paths', () => {
    expect(isSharedProjectPath('src/components/App.tsx')).toBe(true);
    expect(isSharedProjectPath('README.md')).toBe(true);
  });

  it('rejects traversal, absolute, malformed, and excessive paths', () => {
    expect(isSharedProjectPath('../secret.txt')).toBe(false);
    expect(isSharedProjectPath('/root/file.ts')).toBe(false);
    expect(isSharedProjectPath('src\\file.ts')).toBe(false);
    expect(isSharedProjectPath('src//file.ts')).toBe(false);
    expect(isSharedProjectPath(`${'a/'.repeat(32)}file.ts`)).toBe(false);
  });

  it('excludes generated folders and compiled artifacts regardless of case', () => {
    expect(isSharedProjectPath('node_modules/pkg/index.js')).toBe(false);
    expect(isSharedProjectPath('SRC/BUILD/output.js')).toBe(false);
    expect(isSharedProjectPath('bin/Release/App.DLL')).toBe(false);
  });

  it('resolves nested entries and rejects cycles or missing parents', () => {
    const entries = [
      { id: 'folder', name: 'src', parentId: null, isFolder: true },
      { id: 'file', name: 'main.ts', parentId: 'folder', isFolder: false },
    ];
    expect(getProjectEntryPath(entries[1], entries)).toBe('src/main.ts');
    expect(
      getProjectEntryPath(
        { id: 'cycle-a', name: 'a', parentId: 'cycle-b', isFolder: true },
        [
          { id: 'cycle-a', name: 'a', parentId: 'cycle-b', isFolder: true },
          { id: 'cycle-b', name: 'b', parentId: 'cycle-a', isFolder: true },
        ]
      )
    ).toBeNull();
    expect(
      getProjectEntryPath(
        { id: 'orphan', name: 'main.ts', parentId: 'missing', isFolder: false },
        []
      )
    ).toBeNull();
  });
});
