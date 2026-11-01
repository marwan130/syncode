import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, MutableRefObject } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { PreviewLanguage } from './languageModes';
import type { PreviewProject } from '../../hooks/useDebouncedPreview';
import { createPreviewDocument } from './previewDocument';
import {
  usePreviewHistory,
  usePreviewTabs,
  useTypeScriptPreview,
} from './useLivePreviewState';
import type { PreviewTab } from './useLivePreviewState';

export interface LivePreviewProps {
  project: PreviewProject;
  language: PreviewLanguage;
  monaco: Monaco | null;
  editor: MonacoEditor.IStandaloneCodeEditor | null;
  style?: CSSProperties;
}

function sendPreviewDocument(
  port: MessagePort | undefined,
  document: string
): void {
  port?.postMessage({ type: 'syncode-preview-document', document });
}

interface PreviewTabStripProps {
  tabs: PreviewTab[];
  activeTabId: number;
  onSelect: (id: number) => void;
  onAdd: () => void;
  onClose: (id: number) => void;
}

function PreviewTabStrip({
  tabs,
  activeTabId,
  onSelect,
  onAdd,
  onClose,
}: PreviewTabStripProps) {
  return (
    <div className="preview-tab-strip" role="tablist" aria-label="Preview tabs">
      {tabs.map((tab, index) => (
        <div
          className={`preview-tab${activeTabId === tab.id ? ' is-active' : ''}`}
          key={tab.id}
        >
          <button
            className="preview-tab-select"
            type="button"
            role="tab"
            aria-selected={activeTabId === tab.id}
            onClick={() => onSelect(tab.id)}
          >
            Preview {index + 1}
          </button>
          {tabs.length > 1 && (
            <button
              className="preview-tab-close"
              type="button"
              aria-label={`Close preview tab ${index + 1}`}
              title="Close tab"
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        className="preview-new-tab"
        type="button"
        onClick={onAdd}
        aria-label="New preview tab"
        title="New preview tab"
      >
        +
      </button>
    </div>
  );
}

interface PreviewToolbarProps {
  activeTab: PreviewTab | undefined;
  onMoveHistory: (direction: 'back' | 'forward') => void;
  onReload: () => void;
}

function PreviewToolbar({
  activeTab,
  onMoveHistory,
  onReload,
}: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar">
      <button
        className="preview-navigation"
        type="button"
        onClick={() => onMoveHistory('back')}
        disabled={!activeTab?.canGoBack}
        aria-label="Go back in preview"
        title="Back"
      >
        ‹
      </button>
      <button
        className="preview-navigation"
        type="button"
        onClick={() => onMoveHistory('forward')}
        disabled={!activeTab?.canGoForward}
        aria-label="Go forward in preview"
        title="Forward"
      >
        ›
      </button>
      <button
        className="preview-reload"
        type="button"
        onClick={onReload}
        aria-label="Reload active preview"
        title="Reload preview"
      >
        ↻
      </button>
      <div className="preview-address" aria-label="Preview address">
        <span>http://example.com</span>
      </div>
    </div>
  );
}

interface PreviewFramesProps {
  tabs: PreviewTab[];
  activeTabId: number;
  project: PreviewProject;
  language: PreviewLanguage;
  previewSource: string;
  frameRefs: MutableRefObject<Map<number, HTMLIFrameElement>>;
  previewPorts: MutableRefObject<Map<number, MessagePort>>;
  initializedFrames: MutableRefObject<WeakSet<HTMLIFrameElement>>;
  readyTabs: MutableRefObject<Set<number>>;
  latestDocuments: MutableRefObject<Map<number, string>>;
}

function PreviewFrames({
  tabs,
  activeTabId,
  project,
  language,
  previewSource,
  frameRefs,
  previewPorts,
  initializedFrames,
  readyTabs,
  latestDocuments,
}: PreviewFramesProps) {
  return (
    <div className="preview-tab-content">
      {tabs.map((tab, index) => (
        <iframe
          className="preview-frame"
          key={`${tab.id}:${tab.reloadVersion}`}
          ref={(frame) => {
            if (frame) frameRefs.current.set(tab.id, frame);
            else frameRefs.current.delete(tab.id);
          }}
          title={`Live code preview tab ${index + 1}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src="/preview.html"
          onLoad={(event) => {
            const frame = event.currentTarget;
            if (initializedFrames.current.has(frame)) return;
            initializedFrames.current.add(frame);

            const channel = new MessageChannel();
            const port = channel.port1;
            previewPorts.current.get(tab.id)?.close();
            previewPorts.current.set(tab.id, port);
            readyTabs.current.delete(tab.id);
            port.onmessage = (message: MessageEvent<{ type?: string }>) => {
              if (message.data?.type !== 'syncode-preview-ready') return;
              readyTabs.current.add(tab.id);
              sendPreviewDocument(
                port,
                latestDocuments.current.get(tab.id) ??
                  createPreviewDocument(
                    project,
                    language,
                    previewSource,
                    tab.id
                  )
              );
            };
            port.start();
            frame.contentWindow?.postMessage(
              { type: 'syncode-preview-connect', tabId: tab.id },
              '*',
              [channel.port2]
            );
          }}
          hidden={activeTabId !== tab.id}
        />
      ))}
    </div>
  );
}

export function LivePreview({
  project,
  language,
  monaco,
  editor,
  style,
}: LivePreviewProps) {
  const frameRefs = useRef(new Map<number, HTMLIFrameElement>());
  const previewPorts = useRef(new Map<number, MessagePort>());
  const initializedFrames = useRef(new WeakSet<HTMLIFrameElement>());
  const readyTabs = useRef(new Set<number>());
  const latestDocuments = useRef(new Map<number, string>());
  const preview = usePreviewTabs();
  const { source } = project;
  const previewSource = useTypeScriptPreview(language, editor, monaco, source);

  usePreviewHistory(frameRefs, preview.setTabs);

  useEffect(() => {
    const activeTabIds = new Set(preview.tabs.map((tab) => tab.id));
    previewPorts.current.forEach((port, tabId) => {
      if (activeTabIds.has(tabId)) return;
      port.close();
      previewPorts.current.delete(tabId);
      readyTabs.current.delete(tabId);
    });
  }, [preview.tabs]);

  useEffect(
    () => () => {
      previewPorts.current.forEach((port) => port.close());
      previewPorts.current.clear();
      readyTabs.current.clear();
    },
    []
  );

  useLayoutEffect(() => {
    const documents = new Map(
      preview.tabs.map((tab) => [
        tab.id,
        createPreviewDocument(project, language, previewSource, tab.id),
      ])
    );
    latestDocuments.current = documents;
    previewPorts.current.forEach((port, tabId) => {
      if (!readyTabs.current.has(tabId)) return;
      const document = documents.get(tabId);
      if (document) sendPreviewDocument(port, document);
    });
  }, [language, previewSource, preview.tabs, project]);

  return (
    <section className="live-preview" style={style} aria-label="Live preview">
      <PreviewTabStrip
        tabs={preview.tabs}
        activeTabId={preview.activeTabId}
        onSelect={preview.setActiveTabId}
        onAdd={preview.addTab}
        onClose={preview.closeTab}
      />
      <PreviewToolbar
        activeTab={preview.activeTab}
        onMoveHistory={(direction) =>
          preview.moveHistory(previewPorts, direction)
        }
        onReload={preview.reloadTab}
      />
      <PreviewFrames
        tabs={preview.tabs}
        activeTabId={preview.activeTabId}
        project={project}
        language={language}
        previewSource={previewSource}
        frameRefs={frameRefs}
        previewPorts={previewPorts}
        initializedFrames={initializedFrames}
        readyTabs={readyTabs}
        latestDocuments={latestDocuments}
      />
    </section>
  );
}
