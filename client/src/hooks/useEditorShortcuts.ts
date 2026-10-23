import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type * as monaco from 'monaco-editor';
import type { ExecutionLanguage } from '../providers/SignalRCrdtProvider';
import type { LanguageMode } from '../components/editor/languageModes';
import { isPreviewLanguage } from '../components/editor/languageModes';

export interface EditorShortcutOptions {
  isShortcutGuideOpen: boolean;
  setShortcutGuideOpen: Dispatch<SetStateAction<boolean>>;
  isTerminalOpen: boolean;
  canSplitWorkspace: boolean;
  onSplitWorkspace: () => void;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setExplorerOpen: Dispatch<SetStateAction<boolean>>;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
  setNewTerminalRequest: Dispatch<SetStateAction<number>>;
  setStartBashOnTerminalOpen: Dispatch<SetStateAction<boolean>>;
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
  setChatOpen,
  setNewTerminalRequest,
  setStartBashOnTerminalOpen,
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
        setChatOpen,
        setNewTerminalRequest,
        setStartBashOnTerminalOpen,
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
    setNewTerminalRequest,
    setPreviewOpen,
    setShortcutGuideOpen,
    setStartBashOnTerminalOpen,
    setTerminalOpen,
    onSplitWorkspace,
  ]);
}

function focusWorkspaceRegion(
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null,
  reverse: boolean
): void {
  const regions = [
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
    | 'setChatOpen'
    | 'setNewTerminalRequest'
    | 'setStartBashOnTerminalOpen'
    | 'revealTerminalPanel'
    | 'handleRunCode'
  >
): void {
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.repeat)
    return;

  const actions: Record<string, () => void> = {
    s: () => {
      if (!options.canSplitWorkspace) return;
      event.preventDefault();
      options.onSplitWorkspace();
    },
    k: () => {
      event.preventDefault();
      options.setShortcutGuideOpen((open) => !open);
    },
    t: () => {
      event.preventDefault();
      if (options.isTerminalOpen) options.setTerminalOpen(false);
      else {
        options.setStartBashOnTerminalOpen(true);
        options.revealTerminalPanel();
      }
    },
    n: () => {
      event.preventDefault();
      if (options.isTerminalOpen)
        options.setNewTerminalRequest((value) => value + 1);
      else {
        options.setStartBashOnTerminalOpen(true);
        options.revealTerminalPanel();
      }
    },
    q: () => {
      const target = event.target as HTMLElement | null;
      if (options.isTerminalOpen && target?.closest('.execution-terminal')) {
        event.preventDefault();
        window.dispatchEvent(new Event('syncode:terminal-close-active'));
      }
    },
    e: () => {
      event.preventDefault();
      options.setExplorerOpen((open) => !open);
    },
    c: () => {
      event.preventDefault();
      options.setChatOpen((open) => !open);
    },
    p: () => {
      if (isPreviewLanguage(options.language)) {
        event.preventDefault();
        options.setPreviewOpen((open) => !open);
      }
    },
    r: () => {
      if (
        options.canRunCode &&
        options.executionLanguage &&
        options.monacoEditor
      ) {
        event.preventDefault();
        options.handleRunCode();
      }
    },
    w: () => {
      if (options.isTerminalOpen) {
        event.preventDefault();
        options.setStartBashOnTerminalOpen(false);
        options.setTerminalOpen(false);
      }
    },
  };
  actions[event.key.toLowerCase()]?.();
}
