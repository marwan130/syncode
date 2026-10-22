import { describe, expect, it } from 'vitest';
import { normalizeImportPath } from '../pathSafety';

describe('normalizeImportPath', () => {
  it('keeps a safe nested relative path in normalized form', () => {
    expect(normalizeImportPath('src/components/App.tsx')).toBe(
      'src/components/App.tsx'
    );
  });

  it.each([
    '',
    '/etc/passwd',
    '\\server\\share',
    'C:/secret.txt',
    '../secret.txt',
    'src/../secret.txt',
    'src//file.ts',
    'src\\file.ts',
    'src/file?.ts',
    'src/file\u0000.ts',
  ])('rejects unsafe path %j', (path) => {
    expect(() => normalizeImportPath(path)).toThrow(
      'The folder contains an unsafe file path.'
    );
  });

  it('rejects overlong paths and segments', () => {
    expect(() => normalizeImportPath('a'.repeat(513))).toThrow();
    expect(() => normalizeImportPath(`${'a'.repeat(129)}.ts`)).toThrow();
  });

  it('rejects values that do not satisfy the runtime string contract', () => {
    expect(() => normalizeImportPath(null as unknown as string)).toThrow();
  });
});
