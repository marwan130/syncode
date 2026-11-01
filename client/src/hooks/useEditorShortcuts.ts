import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type * as monaco from 'monaco-editor';
import type { ExecutionLanguage } from '../providers/SignalRCrdtProvider';
import type { LanguageMode } from '../components/editor/languageModes';
import { isPreviewLanguage } from '../components/editor/languageModes';
import type { ActivityView } from '../components/editor/ActivityBar';
import { SHORTCUT_DEFINITIONS } from '../components/editor/shortcutDefinitions';
import type { BottomPanelView } from '../components/editor/terminalTypes';

export interface EditorShortcutOptions {
  isShortcutGuideOpen: boolean;
  setShortcutGuideOpen: Dispatch<SetStateAction<boolean>>;
  isTerminalOpen: boolean;
  canSplitWorkspace: boolean;
  onSplitWorkspace: () => void;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setActiveSidebarView: Dispatch<SetStateAction<ActivityView | null>>;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
  setNewTerminalRequest: Dispatch<SetStateAction<number>>;
  setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  revealTerminalPanel: () => void;
  language: LanguageMode;
  canRunCode: boolean;
  executionLanguage: ExecutionLanguage | null;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  handleRunCode: () => void;
}

export function useEditorShortcuts({
  isShortcutGuideOpen,
  setShortcutGuideOpen,
  isTerminalOpen,
  canSplitWorkspace,
  onSplitWorkspace,
  setTerminalOpen,
  setPreviewOpen,
  setExplorerOpen,
  setActiveSidebarView,
  setChatOpen,
  setNewTerminalRequest,
  setBottomPanelView,
  revealTerminalPanel,
  language,
  canRunCode,
  executionLanguage,
  monacoEditor,
  handleRunCode,
}: EditorShortcutOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isShortcutGuideOpen) {
        setShortcutGuideOpen(false);
        return;
      }
      if (isShortcutGuideOpen) return;
      if (event.key === 'F6') {
        event.preventDefault();
        focusWorkspaceRegion(monacoEditor, event.shiftKey);
        return;
      }
      handleCommandShortcut(event, {
        isTerminalOpen,
        canSplitWorkspace,
        onSplitWorkspace,
        language,
        canRunCode,
        executionLanguage,
        monacoEditor,
        setShortcutGuideOpen,
        setTerminalOpen,
        setPreviewOpen,
        setExplorerOpen,
        setActiveSidebarView,
        setChatOpen,
        setNewTerminalRequest,
        setBottomPanelView,
        revealTerminalPanel,
        handleRunCode,
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canRunCode,
    canSplitWorkspace,
    executionLanguage,
    handleRunCode,
    isShortcutGuideOpen,
    isTerminalOpen,
    language,
    monacoEditor,
    revealTerminalPanel,
    setChatOpen,
    setExplorerOpen,
    setActiveSidebarView,
    setNewTerminalRequest,
    setPreviewOpen,
    setShortcutGuideOpen,
    setBottomPanelView,
    setTerminalOpen,
    onSplitWorkspace,
  ]);
}

function focusWorkspaceRegion(
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null,
  reverse: boolean
): void {
  const regions = [
    '.activity-bar',
    '.activity-view',
    '.file-explorer',
    '.room-code-editor',
    '.chat-panel',
    '.live-preview',
    '.execution-terminal',
  ]
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((element): element is HTMLElement =>
      Boolean(element && element.getClientRects().length)
    );
  if (!regions.length) return;
  const active = document.activeElement;
  const current = regions.findIndex(
    (region) => region === active || region.contains(active)
  );
  const direction = reverse ? -1 : 1;
  const nextIndex =
    current < 0
      ? direction > 0
        ? 0
        : regions.length - 1
      : (current + direction + regions.length) % regions.length;
  const next = regions[nextIndex];
  if (next.matches('.room-code-editor')) monacoEditor?.focus();
  else
    (
      next.querySelector<HTMLElement>('button, input, [tabindex="0"]') ?? next
    ).focus();
}

function handleCommandShortcut(
  event: KeyboardEvent,
  options: Pick<
    EditorShortcutOptions,
    | 'isTerminalOpen'
    | 'canSplitWorkspace'
    | 'onSplitWorkspace'
    | 'language'
    | 'canRunCode'
    | 'executionLanguage'
    | 'monacoEditor'
    | 'setShortcutGuideOpen'
    | 'setTerminalOpen'
    | 'setPreviewOpen'
    | 'setExplorerOpen'
    | 'setActiveSidebarView'
    | 'setChatOpen'
    | 'setNewTerminalRequest'
    | 'setBottomPanelView'
    | 'revealTerminalPanel'
    | 'handleRunCode'
  >
): void {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.repeat)
    return;

  const key = event.key.toLowerCase();
  const shortcut = SHORTCUT_DEFINITIONS.find(
    ({ keys }) =>
      keys.length === 3 &&
      keys[0] === 'Ctrl' &&
      keys[1] === 'Alt' &&
      keys[2].toLowerCase() === key
  );
  if (!shortcut) return;
  const actions: Record<string, () => void> = {
    split: () => {
      if (!options.canSplitWorkspace) return;
      event.preventDefault();
      options.onSplitWorkspace();
    },
    shortcuts: () => {
      event.preventDefault();
      options.setShortcutGuideOpen((open) => !open);
    },
    'terminal-toggle': () => {
      event.preventDefault();
      if (options.isTerminalOpen) options.setTerminalOpen(false);
      else {
        options.setBottomPanelView('terminal');
        options.revealTerminalPanel();
      }
    },
    'terminal-new': () => {
      event.preventDefault();
      options.setBottomPanelView('terminal');
      if (options.isTerminalOpen)
        options.setNewTerminalRequest((value) => value + 1);
      else {
        options.revealTerminalPanel();
      }
    },
    'terminal-close-tab': () => {
      const target = event.target as HTMLElement | null;
      if (options.isTerminalOpen && target?.closest('.execution-terminal')) {
        event.preventDefault();
        window.dispatchEvent(new Event('syncode:terminal-close-active'));
      }
    },
    explorer: () => {
      event.preventDefault();
      options.setExplorerOpen((open) => !open);
    },
    search: () => {
      event.preventDefault();
      options.setActiveSidebarView((view) =>
        view === 'search' ? null : 'search'
      );
      if (options.monacoEditor) {
        options.monacoEditor.focus();
        options.monacoEditor
          .getAction('editor.action.startFindReplaceAction')
          ?.run();
      }
    },
    find: () => {
      if (options.monacoEditor) {
        event.preventDefault();
        options.monacoEditor.focus();
        options.monacoEditor.getAction('actions.find')?.run();
      }
    },
    'source-control': () => {
      event.preventDefault();
      options.setActiveSidebarView((view) =>
        view === 'source-control' ? null : 'source-control'
      );
    },
    run: () => {
      event.preventDefault();
      options.setActiveSidebarView((view) => (view === 'run' ? null : 'run'));
    },
    chat: () => {
      event.preventDefault();
      options.setChatOpen((open) => !open);
    },
    preview: () => {
      if (isPreviewLanguage(options.language)) {
        event.preventDefault();
        options.setPreviewOpen((open) => !open);
      }
    },
    'run-active': () => {
      if (
        options.canRunCode &&
        options.executionLanguage &&
        options.monacoEditor
      ) {
        event.preventDefault();
        options.handleRunCode();
      }
    },
    'terminal-panel-close': () => {
      if (options.isTerminalOpen) {
        event.preventDefault();
        options.setTerminalOpen(false);
      }
    },
    problems: () => {
      event.preventDefault();
      options.setBottomPanelView('problems');
      options.revealTerminalPanel();
    },
  };
  actions[shortcut.id]?.();
}
