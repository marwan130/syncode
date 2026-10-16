export type LanguageMode =
  | 'cpp'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'csharp'
  | 'c'
  | 'rust'
  | 'java';

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
  py: 'python',
  pyw: 'python',
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
