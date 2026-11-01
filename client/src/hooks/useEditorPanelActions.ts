import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { BottomPanelView } from '../components/editor/terminalTypes';

export interface UseEditorPanelActionsOptions {
  isTerminalOpen: boolean;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setNewTerminalRequest: Dispatch<SetStateAction<number>>;
  setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  revealTerminalPanel: () => void;
}

export function useEditorPanelActions({
  isTerminalOpen,
  setExplorerOpen,
  setChatOpen,
  setPreviewOpen,
  setTerminalOpen,
  setNewTerminalRequest,
  setBottomPanelView,
  revealTerminalPanel,
}: UseEditorPanelActionsOptions) {
  const toggleExplorer = useCallback(
    () => setExplorerOpen((open) => !open),
    [setExplorerOpen]
  );
  const toggleChat = useCallback(
    () => setChatOpen((open) => !open),
    [setChatOpen]
  );
  const togglePreview = useCallback(
    () => setPreviewOpen((open) => !open),
    [setPreviewOpen]
  );
  const openTerminal = useCallback(() => {
    setBottomPanelView('terminal');
    if (isTerminalOpen) setNewTerminalRequest((value) => value + 1);
    revealTerminalPanel();
  }, [
    isTerminalOpen,
    revealTerminalPanel,
    setNewTerminalRequest,
    setBottomPanelView,
  ]);
  const closeTerminal = useCallback(() => {
    setTerminalOpen(false);
  }, [setTerminalOpen]);

  return {
    closeTerminal,
    openTerminal,
    toggleChat,
    toggleExplorer,
    togglePreview,
  };
}
