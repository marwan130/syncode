import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { LanguageMode } from '../components/editor/languageModes';

export interface CodeValidationOptions {
  code: string;
  language: LanguageMode;
  filePath: string;
  isConnected: boolean;
  monacoApi?: Monaco | null;
  model?: monaco.editor.ITextModel | null;
}

export interface CodeValidationResult {
  canRun: boolean;
  reason?: string;
}

const RUNNABLE_LANGUAGES: Set<LanguageMode> = new Set([
  'javascript',
  'typescript',
  'python',
  'csharp',
  'c',
  'cpp',
  'rust',
  'java',
]);

/**
 * Uses native Monaco editor diagnostics and environment checks 
 */
export function validateCodeForExecution(
  options: CodeValidationOptions
): CodeValidationResult {
  const { code, language, filePath, isConnected, monacoApi, model } = options;

  if (!isConnected) {
    return { canRun: false, reason: 'Connect to the room to run code' };
  }

  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'jsx' || extension === 'tsx') {
    return {
      canRun: false,
      reason:
        'This file type requires a project build and cannot run as a single file',
    };
  }

  if (language === 'html' || language === 'css') {
    return {
      canRun: false,
      reason: 'HTML and CSS cannot be run directly. Use the Preview panel.',
    };
  }

  if (!RUNNABLE_LANGUAGES.has(language)) {
    return {
      canRun: false,
      reason: 'This file type cannot be executed',
    };
  }

  if (!code.trim()) {
    return {
      canRun: false,
      reason: 'Cannot run empty code',
    };
  }

  // Native Monaco diagnostic markers (syntax errors, lint/compiler errors)
  if (monacoApi && model) {
    const errorSeverity = monacoApi.MarkerSeverity?.Error ?? 8;
    const markers = monacoApi.editor.getModelMarkers({ resource: model.uri });
    const firstError = markers.find(
      (m: monaco.editor.IMarker) => m.severity === errorSeverity
    );
    if (firstError) {
      return {
        canRun: false,
        reason: `Syntax error on line ${firstError.startLineNumber}: ${firstError.message}`,
      };
    }
  }

  return { canRun: true };
}
