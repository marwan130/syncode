import { useCallback, useRef } from 'react';
import type { ExecutionLanguage } from '../providers/SignalRCrdtProvider';
import type * as monaco from 'monaco-editor';

export interface UseEditorRunActionOptions {
  canRunCode: boolean;
  executionLanguage: ExecutionLanguage | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  activeFilePath: string;
  runCode: (language: ExecutionLanguage, sourcePath: string) => void;
}

export function useEditorRunAction({
  canRunCode,
  executionLanguage,
  editor,
  activeFilePath,
  runCode,
}: UseEditorRunActionOptions) {
  const lastRunAt = useRef(0);
  return useCallback(() => {
    if (!canRunCode || !executionLanguage || !editor) return;
    const now = Date.now();
    if (now - lastRunAt.current < 1000) return;
    lastRunAt.current = now;
    runCode(executionLanguage, activeFilePath);
  }, [activeFilePath, canRunCode, editor, executionLanguage, runCode]);
}
