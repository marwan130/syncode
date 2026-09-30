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
