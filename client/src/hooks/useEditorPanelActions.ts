import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface UseEditorPanelActionsOptions {
  isTerminalOpen: boolean;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setNewTerminalRequest: Dispatch<SetStateAction<number>>;
  setStartBashOnTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setSplitWorkspaceOpen: Dispatch<SetStateAction<boolean>>;
  setSplitFileId: (fileId: string | null) => void;
  setActiveEditorGroup: (group: 'primary' | 'secondary') => void;
  revealTerminalPanel: () => void;
}

export function useEditorPanelActions({
  isTerminalOpen,
  setExplorerOpen,
  setChatOpen,
  setPreviewOpen,
  setTerminalOpen,
  setNewTerminalRequest,
  setStartBashOnTerminalOpen,
  setSplitWorkspaceOpen,
  setSplitFileId,
  setActiveEditorGroup,
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
  const closeSplitGroup = useCallback(() => {
    setSplitWorkspaceOpen(false);
    setSplitFileId(null);
    setActiveEditorGroup('primary');
  }, [setActiveEditorGroup, setSplitFileId, setSplitWorkspaceOpen]);
  const openTerminal = useCallback(() => {
    if (isTerminalOpen) setNewTerminalRequest((value) => value + 1);
    else setStartBashOnTerminalOpen(true);
    revealTerminalPanel();
  }, [
    isTerminalOpen,
    revealTerminalPanel,
    setNewTerminalRequest,
    setStartBashOnTerminalOpen,
  ]);
  const closeTerminal = useCallback(() => {
    setStartBashOnTerminalOpen(false);
    setTerminalOpen(false);
  }, [setStartBashOnTerminalOpen, setTerminalOpen]);

  return {
    closeSplitGroup,
    closeTerminal,
    openTerminal,
    toggleChat,
    toggleExplorer,
    togglePreview,
  };
}
