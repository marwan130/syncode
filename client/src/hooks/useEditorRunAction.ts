import { useCallback } from 'react';
import type { ExecutionLanguage } from '../providers/SignalRCrdtProvider';
import type * as monaco from 'monaco-editor';

export interface UseEditorRunActionOptions {
  canRunCode: boolean;
  isRunning: boolean;
  executionLanguage: ExecutionLanguage | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  activeFilePath: string;
  runCode: (
    language: ExecutionLanguage,
    sourcePath: string
  ) => Promise<void>;
  revealTerminalPanel: () => void;
  setStartBashOnTerminalOpen: (start: boolean) => void;
}

export function useEditorRunAction({
  canRunCode,
  isRunning,
  executionLanguage,
  editor,
  activeFilePath,
  runCode,
  revealTerminalPanel,
  setStartBashOnTerminalOpen,
}: UseEditorRunActionOptions) {
  return useCallback(() => {
    if (!canRunCode || isRunning || !executionLanguage || !editor) return;
    setStartBashOnTerminalOpen(false);
    revealTerminalPanel();
    void runCode(executionLanguage, activeFilePath);
  }, [
    activeFilePath,
    canRunCode,
    editor,
    executionLanguage,
    isRunning,
    revealTerminalPanel,
    runCode,
    setStartBashOnTerminalOpen,
  ]);
}
