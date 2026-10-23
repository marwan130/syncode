import { describe, expect, it } from 'vitest';
import { isPreviewLanguage, languageForFileName } from '../languageModes';

describe('language selection', () => {
  it.each([
    ['app.py', 'python'],
    ['page.HTML', 'html'],
    ['script.mjs', 'javascript'],
    ['types.ts', 'typescript'],
    ['component.tsx', 'typescript'],
    ['program.c', 'c'],
    ['program.hpp', 'cpp'],
    ['Program.cs', 'csharp'],
    ['main.rs', 'rust'],
    ['Main.java', 'java'],
  ])('maps %s to %s', (name, language) => {
    expect(languageForFileName(name)).toBe(language);
  });

  it('uses the existing default for unknown extensions', () => {
    expect(languageForFileName('notes.unknown')).toBe('cpp');
    expect(languageForFileName('untitled')).toBe('cpp');
  });

  it('identifies only languages supported by the live preview', () => {
    expect(isPreviewLanguage('html')).toBe(true);
    expect(isPreviewLanguage('typescript')).toBe(true);
    expect(isPreviewLanguage('python')).toBe(false);
    expect(isPreviewLanguage('rust')).toBe(false);
  });
});
