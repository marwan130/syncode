import type * as monaco from 'monaco-editor';
import { useChat } from '../../hooks/useChat';
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
  language,
  monacoEditor,
  monacoApi,
  canSplitWorkspace,
  splitWorkspace,
  panels,
  requestRun,
}: {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  activeFile?: RoomEntry;
  activeFilePath: string;
  language: LanguageMode;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  monacoApi: import('@monaco-editor/react').Monaco | null;
  canSplitWorkspace: boolean;
  splitWorkspace: () => void;
  panels: ReturnType<typeof useEditorPanelState>;
  requestRun: (language: ExecutionLanguage, sourcePath: string) => void;
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
  const handleRunCode = useEditorRunAction({
    canRunCode,
    executionLanguage,
    editor: monacoEditor,
    activeFilePath,
    runCode: requestRun,
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
    setBottomPanelView: panels.setBottomPanelView,
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
    handleRunCode,
  };
}
