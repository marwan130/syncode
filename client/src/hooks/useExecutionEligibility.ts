import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type {
  RoomEntry,
  ExecutionLanguage,
} from '../providers/SignalRCrdtProvider';
import { validateCodeForExecution } from '../utils/codeValidation';
import type { CodeValidationResult } from '../utils/codeValidation';
import type { LanguageMode } from '../components/editor/languageModes';

const EXECUTION_LANGUAGES: Partial<Record<LanguageMode, ExecutionLanguage>> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  csharp: 'CSharp',
  c: 'C',
  cpp: 'Cpp',
  rust: 'Rust',
  java: 'Java',
};

export interface ExecutionEligibilityOptions {
  activeFile?: RoomEntry;
  activeFilePath: string;
  language: LanguageMode;
  status: string;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  monacoApi: Monaco | null;
}

export function useExecutionEligibility({
  activeFile,
  activeFilePath,
  language,
  status,
  monacoEditor,
  monacoApi,
}: ExecutionEligibilityOptions) {
  const sourceExtension = activeFilePath.split('.').pop()?.toLowerCase();
  const requiresProjectJsxTransform =
    sourceExtension === 'jsx' || sourceExtension === 'tsx';
  const executionLanguage = requiresProjectJsxTransform
    ? null
    : (EXECUTION_LANGUAGES[language] ?? null);
  const [validationResult, setValidationResult] =
    useState<CodeValidationResult>(() =>
      validateCodeForExecution({
        code: '',
        language,
        filePath: activeFilePath,
        isConnected: Boolean(activeFile && status === 'connected'),
      })
    );

  useEffect(() => {
    const checkValidation = () => {
      const model = monacoEditor?.getModel();
      setValidationResult(
        validateCodeForExecution({
          code: model?.getValue() ?? '',
          language,
          filePath: activeFilePath,
          isConnected: Boolean(activeFile && status === 'connected'),
          monacoApi,
          model,
        })
      );
    };

    checkValidation();
    if (!monacoEditor) return;

    const contentSubscription =
      monacoEditor.onDidChangeModelContent(checkValidation);
    const markerSubscription =
      monacoApi?.editor.onDidChangeMarkers(checkValidation);

    return () => {
      contentSubscription.dispose();
      markerSubscription?.dispose();
    };
  }, [monacoEditor, monacoApi, language, activeFilePath, activeFile, status]);

  return {
    executionLanguage,
    canRunCode: Boolean(
      validationResult.canRun && executionLanguage && monacoEditor
    ),
    runDisabledReason: !executionLanguage
      ? requiresProjectJsxTransform
        ? 'This file type requires a project build and cannot run as a single file'
        : 'This file type cannot be executed'
      : validationResult.reason,
  };
}
