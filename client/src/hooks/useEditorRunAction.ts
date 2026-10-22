import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  ExecutionLanguage,
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type * as monaco from 'monaco-editor';
import { getEntryPath } from '../components/editor/editorLayoutStorage';

export interface UseEditorRunActionOptions {
  canRunCode: boolean;
  isRunning: boolean;
  executionLanguage: ExecutionLanguage | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  activeFile?: RoomEntry;
  activeFilePath: string;
  entries: RoomEntry[];
  providerRef: RefObject<SignalRCrdtProvider | null>;
  runCode: (
    language: ExecutionLanguage,
    source: string,
    sourcePath: string,
    projectFiles: { path: string; content: string }[]
  ) => Promise<void>;
  revealTerminalPanel: () => void;
  setStartBashOnTerminalOpen: (start: boolean) => void;
}

export function useEditorRunAction({
  canRunCode,
  isRunning,
  executionLanguage,
  editor,
  activeFile,
  activeFilePath,
  entries,
  providerRef,
  runCode,
  revealTerminalPanel,
  setStartBashOnTerminalOpen,
}: UseEditorRunActionOptions) {
  return useCallback(() => {
    if (!canRunCode || isRunning || !executionLanguage || !editor) return;
    setStartBashOnTerminalOpen(false);
    revealTerminalPanel();
    const source = editor.getValue();
    const projectFiles = entries
      .filter((entry) => !entry.isFolder)
      .map((entry) => ({
        path: getEntryPath(entry, entries),
        content:
          entry.id === activeFile?.id
            ? source
            : (providerRef.current?.getFileContent(entry.id) ?? ''),
      }));
    void runCode(executionLanguage, source, activeFilePath, projectFiles);
  }, [
    activeFile?.id,
    activeFilePath,
    canRunCode,
    editor,
    entries,
    executionLanguage,
    isRunning,
    providerRef,
    revealTerminalPanel,
    runCode,
    setStartBashOnTerminalOpen,
  ]);
}
