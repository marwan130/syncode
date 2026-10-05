export const LANGUAGE_MODES = [
  { id: 'cpp', label: 'C++' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'csharp', label: 'C#' },
  { id: 'c', label: 'C' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
] as const;

export type LanguageMode = (typeof LANGUAGE_MODES)[number]['id'];

export type PreviewLanguage = 'html' | 'css' | 'javascript' | 'typescript';

export function isPreviewLanguage(
  language: LanguageMode
): language is PreviewLanguage {
  return (
    language === 'html' ||
    language === 'css' ||
    language === 'javascript' ||
    language === 'typescript'
  );
}

const EXTENSION_LANGUAGES: Record<string, LanguageMode> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  java: 'java',
};

export function languageForFileName(name: string): LanguageMode {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_LANGUAGES[extension] ?? 'cpp';
}
