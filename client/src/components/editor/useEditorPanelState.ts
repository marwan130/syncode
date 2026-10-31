import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useEditorPanelActions } from '../../hooks/useEditorPanelActions';
import {
  DEFAULT_CHAT_WIDTH,
  getStoredExplorerWidth,
  getStoredTerminalHeight,
} from './editorLayoutStorage';
import type { useEditorWorkspaceState } from './useEditorWorkspaceState';
import type { ActivityView } from './ActivityBar';

export function useEditorPanelState(
  workspace: ReturnType<typeof useEditorWorkspaceState>
) {
  const layout = useEditorPanelLayoutState();
  const terminal = useEditorTerminalState();
  const actions = useEditorPanelActions({
    isTerminalOpen: terminal.isTerminalOpen,
    setExplorerOpen: layout.setExplorerOpen,
    setChatOpen: layout.setChatOpen,
    setPreviewOpen: workspace.setPreviewOpen,
    setTerminalOpen: terminal.setTerminalOpen,
    setNewTerminalRequest: terminal.setNewTerminalRequest,
    setBottomPanelView: terminal.setBottomPanelView,
    revealTerminalPanel: terminal.revealTerminalPanel,
  });
  return {
    ...layout,
    ...terminal,
    actions,
    setPreviewOpen: workspace.setPreviewOpen,
  };
}

function useEditorPanelLayoutState() {
  const [activeSidebarView, setActiveSidebarView] =
    useState<ActivityView | null>('explorer');
  const isExplorerOpen = activeSidebarView === 'explorer';
  const setExplorerOpen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (action) =>
      setActiveSidebarView((current) => {
        const open =
          typeof action === 'function'
            ? action(current === 'explorer')
            : action;
        if (open) return 'explorer';
        return current === 'explorer' ? null : current;
      }),
    []
  );
  const [explorerWidth, setExplorerWidth] = useState(getStoredExplorerWidth);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [isChatOpen, setChatOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(getStoredTerminalHeight);
  const [isShortcutGuideOpen, setShortcutGuideOpen] = useState(false);

  return {
    isExplorerOpen,
    setExplorerOpen,
    activeSidebarView,
    setActiveSidebarView,
    explorerWidth,
    setExplorerWidth,
    chatWidth,
    setChatWidth,
    isChatOpen,
    setChatOpen,
    terminalHeight,
    setTerminalHeight,
    isShortcutGuideOpen,
    setShortcutGuideOpen,
  };
}

function useEditorTerminalState() {
  const [newTerminalRequest, setNewTerminalRequest] = useState(0);
  const [terminalPanelMounted, setTerminalPanelMounted] = useState(false);
  const [isTerminalOpen, setTerminalOpen] = useState(false);
  const [bottomPanelView, setBottomPanelView] = useState<
    'terminal' | 'problems'
  >('terminal');

  const revealTerminalPanel = useCallback(() => {
    setTerminalPanelMounted(true);
    setTerminalOpen(true);
  }, []);

  return {
    newTerminalRequest,
    setNewTerminalRequest,
    terminalPanelMounted,
    setTerminalPanelMounted,
    isTerminalOpen,
    setTerminalOpen,
    bottomPanelView,
    setBottomPanelView,
    revealTerminalPanel,
  };
}
