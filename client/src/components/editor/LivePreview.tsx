import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { PreviewLanguage } from './languageModes';
import type { PreviewProject } from '../../hooks/useDebouncedPreview';

interface LivePreviewProps {
  project: PreviewProject;
  language: PreviewLanguage;
  monaco: Monaco | null;
  editor: MonacoEditor.IStandaloneCodeEditor | null;
  style?: CSSProperties;
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

interface PreviewTab {
  id: number;
  reloadVersion: number;
  canGoBack: boolean;
  canGoForward: boolean;
}

const CONTENT_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function resolveRoomPath(from: string, requested: string): string {
  const cleanRequest = decodeURIComponent(requested.split(/[?#]/, 1)[0] ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  const parts = requested.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of cleanRequest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function createPreviewDocument(
  project: PreviewProject,
  language: LivePreviewProps['language'],
  javascriptOverride: string | undefined,
  tabId: number
): string {
  const historyScript = `<script>(()=>{
    const tabId=${tabId};
    let entries=[location.href], index=0, pendingMove=null, lastHref=location.href;
    const publish=()=>parent.postMessage({type:'syncode-preview-history',tabId,canGoBack:index>0,canGoForward:index<entries.length-1},'*');
    const pushEntry=()=>{entries=entries.slice(0,index+1);entries.push(location.href);index++;lastHref=location.href;publish()};
    const originalPushState=history.pushState.bind(history);
    history.pushState=(...args)=>{originalPushState(...args);pushEntry()};
    const originalReplaceState=history.replaceState.bind(history);
    history.replaceState=(...args)=>{originalReplaceState(...args);lastHref=location.href;publish()};
    const changed=()=>{
      if(pendingMove!==null){index=Math.max(0,Math.min(entries.length-1,index+pendingMove));pendingMove=null;lastHref=location.href;publish();return}
      if(location.href!==lastHref)pushEntry();
    };
    addEventListener('popstate',changed);
    addEventListener('hashchange',changed);
    addEventListener('message',event=>{
      if(event.source!==parent||event.data?.tabId!==tabId)return;
      if(event.data.type==='syncode-preview-history-state')publish();
      if(event.data.type==='syncode-preview-history-move'){
        const direction=event.data.direction;
        if((direction==='back'&&index>0)||(direction==='forward'&&index<entries.length-1)){
          pendingMove=direction==='back'?-1:1;
          history[direction]();
          setTimeout(()=>{pendingMove=null},1000);
        }
      }
    });
    publish();
  })();</script>`;
  const policy = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_POLICY}">${historyScript}`;
  const files = new Map(
    project.files.map((file) => [file.path.toLowerCase(), file.content])
  );
  const activeDirectory = project.activeFilePath.split('/').slice(0, -1).join('/');
  const htmlEntry =
    project.files.find((file) => file.path.toLowerCase() === 'index.html') ??
    project.files.find(
      (file) =>
        file.path.toLowerCase() ===
        `${activeDirectory ? `${activeDirectory}/` : ''}index.html`.toLowerCase()
    ) ??
    project.files.find(
      (file) => file.path === project.activeFilePath && language === 'html'
    ) ??
    project.files.find((file) => file.path.toLowerCase().endsWith('/index.html'));

  if (htmlEntry) {
    let html = htmlEntry.content;
    html = html.replace(
      /<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*>/gi,
      (tag) => {
        const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
        if (!href || /^(?:[a-z]+:|\/\/|data:|#)/i.test(href)) return tag;
        const css = files.get(
          resolveRoomPath(htmlEntry.path, href).toLowerCase()
        );
        if (css === undefined) return tag;
        const media = tag.match(/\bmedia\s*=\s*(["'])(.*?)\1/i)?.[2];
        return `<style${media ? ` media="${media}"` : ''}>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
      }
    );
    html = html.replace(
      /<script\b(?=[^>]*\bsrc\s*=)[^>]*>\s*<\/script\s*>/gi,
      (tag) => {
        const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
        if (!src || /^(?:[a-z]+:|\/\/|data:|#)/i.test(src)) return tag;
        const scriptPath = resolveRoomPath(htmlEntry.path, src);
        const script =
          scriptPath.toLowerCase() === project.activeFilePath.toLowerCase() &&
          javascriptOverride !== undefined
            ? javascriptOverride
            : files.get(scriptPath.toLowerCase());
        if (script === undefined) return tag;
        const attributes = (tag.match(/^<script\b([^>]*)>/i)?.[1] ?? '')
          .replace(/\bsrc\s*=\s*(["']).*?\1/i, '')
          .replace(/\s+$/, '');
        return `<script${attributes}>${script.replace(/<\/script/gi, '<\\/script')}</script>`;
      }
    );
    if (/<head\b[^>]*>/i.test(html)) {
      return html.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`);
    }
    if (/<html\b[^>]*>/i.test(html)) {
      return html.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${policy}</head>`);
    }
    return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
  }

  const source = javascriptOverride ?? project.source;
  const styles = project.files
    .filter((file) => file.path.toLowerCase().endsWith('.css'))
    .map((file) => `<style>${file.content.replace(/<\/style/gi, '<\\/style')}</style>`)
    .join('');

  if (language === 'css') {
    return `<!doctype html><html><head>${policy}${styles || `<style>${source.replace(/<\/style/gi, '<\\/style')}</style>`}</head><body></body></html>`;
  }

  const safeScript = source.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head>${policy}${styles}</head><body><script>${safeScript}</script></body></html>`;
}

export function LivePreview({
  project,
  language,
  monaco,
  editor,
  style,
}: LivePreviewProps) {
  const [compiled, setCompiled] = useState({ source: '', javascript: '' });
  const [tabs, setTabs] = useState<PreviewTab[]>([
    { id: 1, reloadVersion: 0, canGoBack: false, canGoForward: false },
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [nextTabId, setNextTabId] = useState(2);
  const frameRefs = useRef(new Map<number, HTMLIFrameElement>());
  const { source } = project;

  useEffect(() => {
    const updateHistory = (event: MessageEvent) => {
      const state = event.data;
      if (
        state?.type !== 'syncode-preview-history' ||
        typeof state.tabId !== 'number' ||
        typeof state.canGoBack !== 'boolean' ||
        typeof state.canGoForward !== 'boolean'
      ) return;
      if (event.source !== frameRefs.current.get(state.tabId)?.contentWindow) return;
      setTabs((current) => current.map((tab) => tab.id === state.tabId
        ? { ...tab, canGoBack: state.canGoBack, canGoForward: state.canGoForward }
        : tab));
    };
    window.addEventListener('message', updateHistory);
    return () => window.removeEventListener('message', updateHistory);
  }, []);

  useEffect(() => {
    if (language !== 'typescript') return;

    const model = editor?.getModel();
    if (!monaco || !model) return;
    const monacoInstance = monaco;
    const activeModel = model;

    let cancelled = false;
    async function compileTypeScript() {
      try {
        const typescriptApi = (
          monacoInstance as unknown as { typescript: MonacoTypeScriptApi }
        ).typescript;
        const getWorker = await typescriptApi.getTypeScriptWorker();
        const worker = await getWorker(activeModel.uri);
        const output = await worker.getEmitOutput(activeModel.uri.toString());
        const javascript = output.outputFiles.find((file) =>
          file.name.endsWith('.js')
        )?.text;
        if (!cancelled) {
          setCompiled({
            source,
            javascript: output.emitSkipped ? '' : (javascript ?? ''),
          });
        }
      } catch {
        if (!cancelled) setCompiled({ source, javascript: '' });
      }
    }

    compileTypeScript();
    return () => {
      cancelled = true;
    };
  }, [editor, language, monaco, source]);

  const previewSource =
    language === 'typescript'
      ? compiled.source === source
        ? compiled.javascript
        : ''
      : source;
  const getDocument = (tabId: number) =>
    createPreviewDocument(project, language, previewSource, tabId);

  const addTab = () => {
    const tab = {
      id: nextTabId,
      reloadVersion: 0,
      canGoBack: false,
      canGoForward: false,
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setNextTabId((id) => id + 1);
  };

  const closeTab = (tabId: number) => {
    if (tabs.length <= 1) return;
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId);
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[Math.max(0, closedIndex - 1)].id);
    }
    setTabs(remaining);
  };

  const reloadTab = () => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, reloadVersion: tab.reloadVersion + 1 }
          : tab
      )
    );
  };

  const moveHistory = (direction: 'back' | 'forward') => {
    frameRefs.current.get(activeTabId)?.contentWindow?.postMessage(
      { type: 'syncode-preview-history-move', tabId: activeTabId, direction },
      '*'
    );
  };
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <section className="live-preview" style={style} aria-label="Live preview">
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
              onClick={() => setActiveTabId(tab.id)}
            >
              Preview {index + 1}
            </button>
            {tabs.length > 1 && (
              <button
                className="preview-tab-close"
                type="button"
                aria-label={`Close preview tab ${index + 1}`}
                title="Close tab"
                onClick={() => closeTab(tab.id)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="preview-new-tab"
          type="button"
          onClick={addTab}
          aria-label="New preview tab"
          title="New preview tab"
        >
          +
        </button>
      </div>
      <div className="preview-toolbar">
        <button
          className="preview-navigation"
          type="button"
          onClick={() => moveHistory('back')}
          disabled={!activeTab?.canGoBack}
          aria-label="Go back in preview"
          title="Back"
        >
          ‹
        </button>
        <button
          className="preview-navigation"
          type="button"
          onClick={() => moveHistory('forward')}
          disabled={!activeTab?.canGoForward}
          aria-label="Go forward in preview"
          title="Forward"
        >
          ›
        </button>
        <button
          className="preview-reload"
          type="button"
          onClick={reloadTab}
          aria-label="Reload active preview"
          title="Reload preview"
        >
          ↻
        </button>
        <div className="preview-address" aria-label="Preview address">
          <span>http://example.com</span>
        </div>
      </div>
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
            srcDoc={getDocument(tab.id)}
            onLoad={() => frameRefs.current.get(tab.id)?.contentWindow?.postMessage(
              { type: 'syncode-preview-history-state', tabId: tab.id },
              '*'
            )}
            hidden={activeTabId !== tab.id}
          />
        ))}
      </div>
    </section>
  );
}
