import type * as monaco from 'monaco-editor';
import { useChat } from '../../hooks/useChat';
import { useExecutionStream } from '../../hooks/useExecutionStream';
import { useExecutionEligibility } from '../../hooks/useExecutionEligibility';
import { useEditorRunAction } from '../../hooks/useEditorRunAction';
import { useEditorShortcuts } from '../../hooks/useEditorShortcuts';
import type {
  ConnectionStatus,
  ExecutionLanguage,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { RefObject } from 'react';
import type { LanguageMode } from './languageModes';
import type { useEditorPanelState } from './useEditorPanelState';

export function useEditorActivityState({
  providerRef,
  status,
  activeFile,
  activeFilePath,
  entries,
  language,
  monacoEditor,
  monacoApi,
  canSplitWorkspace,
  splitWorkspace,
  panels,
}: {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  activeFile?: RoomEntry;
  activeFilePath: string;
  entries: RoomEntry[];
  language: LanguageMode;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  monacoApi: import('@monaco-editor/react').Monaco | null;
  canSplitWorkspace: boolean;
  splitWorkspace: () => void;
  panels: ReturnType<typeof useEditorPanelState>;
}) {
  const { executionLanguage, canRunCode, runDisabledReason } =
    useExecutionEligibility({
      activeFile,
      activeFilePath,
      language,
      status,
      monacoEditor,
      monacoApi,
    });
  const { messages, sendMessage } = useChat({ providerRef, status });
  const execution = useExecutionStream({ providerRef, status });
  const handleRunCode = useEditorRunAction({
    canRunCode,
    isRunning: execution.isRunning,
    executionLanguage,
    editor: monacoEditor,
    activeFile,
    activeFilePath,
    entries,
    providerRef,
    runCode: execution.runCode,
    revealTerminalPanel: panels.revealTerminalPanel,
    setStartBashOnTerminalOpen: panels.setStartBashOnTerminalOpen,
  });

  useEditorShortcuts({
    isShortcutGuideOpen: panels.isShortcutGuideOpen,
    setShortcutGuideOpen: panels.setShortcutGuideOpen,
    isTerminalOpen: panels.isTerminalOpen,
    canSplitWorkspace,
    onSplitWorkspace: splitWorkspace,
    setTerminalOpen: panels.setTerminalOpen,
    setPreviewOpen: panels.setPreviewOpen,
    setExplorerOpen: panels.setExplorerOpen,
    setActiveSidebarView: panels.setActiveSidebarView,
    setChatOpen: panels.setChatOpen,
    setNewTerminalRequest: panels.setNewTerminalRequest,
    setStartBashOnTerminalOpen: panels.setStartBashOnTerminalOpen,
    revealTerminalPanel: panels.revealTerminalPanel,
    language,
    canRunCode,
    executionLanguage: executionLanguage as ExecutionLanguage | null,
    monacoEditor,
    handleRunCode,
  });

  return {
    executionLanguage,
    canRunCode,
    runDisabledReason,
    messages,
    sendMessage,
    execution,
    handleRunCode,
  };
}
