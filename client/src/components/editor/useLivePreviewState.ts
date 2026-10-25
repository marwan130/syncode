import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { PreviewLanguage } from './languageModes';

export interface PreviewTab {
  id: number;
  reloadVersion: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface HistoryState {
  tabId: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface TypeScriptEmitOutput {
  emitSkipped: boolean;
  outputFiles: Array<{ name: string; text: string }>;
}

interface MonacoTypeScriptApi {
  getTypeScriptWorker: () => Promise<
    (uri: unknown) => Promise<{
      getEmitOutput: (fileName: string) => Promise<TypeScriptEmitOutput>;
    }>
  >;
}

const FIRST_PREVIEW_TAB: PreviewTab = {
  id: 1,
  reloadVersion: 0,
  canGoBack: false,
  canGoForward: false,
};

function isHistoryState(value: unknown): value is HistoryState & { type: string } {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return isHistoryMessage(state) && hasValidHistoryFlags(state);
}

function isHistoryMessage(state: Record<string, unknown>): boolean {
  return state.type === 'syncode-preview-history';
}

function hasValidHistoryFlags(state: Record<string, unknown>): boolean {
  return (
    typeof state.tabId === 'number' &&
    typeof state.canGoBack === 'boolean' &&
    typeof state.canGoForward === 'boolean'
  );
}

function applyHistoryState(
  event: MessageEvent,
  frameRefs: MutableRefObject<Map<number, HTMLIFrameElement>>,
  setTabs: Dispatch<SetStateAction<PreviewTab[]>>
): void {
  if (!isHistoryState(event.data)) return;
  if (event.source !== frameRefs.current.get(event.data.tabId)?.contentWindow) return;
  setTabs((current) =>
    current.map((tab) =>
      tab.id === event.data.tabId
        ? {
            ...tab,
            canGoBack: event.data.canGoBack,
            canGoForward: event.data.canGoForward,
          }
        : tab
    )
  );
}

export function usePreviewHistory(
  frameRefs: MutableRefObject<Map<number, HTMLIFrameElement>>,
  setTabs: Dispatch<SetStateAction<PreviewTab[]>>
): void {
  useEffect(() => {
    const updateHistory = (event: MessageEvent) =>
      applyHistoryState(event, frameRefs, setTabs);
    window.addEventListener('message', updateHistory);
    return () => window.removeEventListener('message', updateHistory);
  }, [frameRefs, setTabs]);
}

export function usePreviewTabs() {
  const [tabs, setTabs] = useState<PreviewTab[]>([FIRST_PREVIEW_TAB]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [nextTabId, setNextTabId] = useState(2);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const addTab = useCallback(() => {
    const tab: PreviewTab = {
      id: nextTabId,
      reloadVersion: 0,
      canGoBack: false,
      canGoForward: false,
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setNextTabId((id) => id + 1);
  }, [nextTabId]);

  const closeTab = useCallback(
    (tabId: number) => {
      if (tabs.length <= 1) return;
      const index = tabs.findIndex((tab) => tab.id === tabId);
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(remaining[Math.max(0, index - 1)].id);
      }
      setTabs(remaining);
    },
    [activeTabId, tabs]
  );

  const reloadTab = useCallback(() => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, reloadVersion: tab.reloadVersion + 1 }
          : tab
      )
    );
  }, [activeTabId]);

  const moveHistory = useCallback(
    (
      frameRefs: MutableRefObject<Map<number, HTMLIFrameElement>>,
      direction: 'back' | 'forward'
    ) => {
      frameRefs.current
        .get(activeTabId)
        ?.contentWindow?.postMessage(
          { type: 'syncode-preview-history-move', tabId: activeTabId, direction },
          '*'
        );
    },
    [activeTabId]
  );

  return {
    tabs,
    setTabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    reloadTab,
    moveHistory,
  };
}

async function compileTypeScript(
  monaco: Monaco,
  model: MonacoEditor.ITextModel
): Promise<string> {
  const typescriptApi = (monaco as unknown as { typescript: MonacoTypeScriptApi })
    .typescript;
  const getWorker = await typescriptApi.getTypeScriptWorker();
  const worker = await getWorker(model.uri);
  const output = await worker.getEmitOutput(model.uri.toString());
  return output.emitSkipped
    ? ''
    : (output.outputFiles.find((file) => file.name.endsWith('.js'))?.text ?? '');
}

export function useTypeScriptPreview(
  language: PreviewLanguage,
  editor: MonacoEditor.IStandaloneCodeEditor | null,
  monaco: Monaco | null,
  source: string
): string {
  const [compiled, setCompiled] = useState({ source: '', javascript: '' });

  useEffect(() => {
    if (language !== 'typescript') return;
    const model = editor?.getModel();
    if (!monaco || !model) return;

    let cancelled = false;
    compileTypeScript(monaco, model)
      .then((javascript) => {
        if (!cancelled) setCompiled({ source, javascript });
      })
      .catch(() => {
        if (!cancelled) setCompiled({ source, javascript: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [editor, language, monaco, source]);

  if (language !== 'typescript') return source;
  return compiled.source === source ? compiled.javascript : '';
}
