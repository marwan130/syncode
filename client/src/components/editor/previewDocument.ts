import type { PreviewLanguage } from './languageModes';
import type { PreviewProject } from '../../hooks/useDebouncedPreview';

const PREVIEW_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`;

function safeDecodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function resolveRoomPath(from: string, requested: string): string {
  const rawPath = safeDecodePath(requested.split(/[?#]/, 1)[0] ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  const base = requested.startsWith('/') ? [] : from.split('/').slice(0, -1);
  return [...base, ...rawPath.split('/')]
    .reduce<string[]>((parts, segment) => {
      if (!segment || segment === '.') return parts;
      return segment === '..' ? parts.slice(0, -1) : [...parts, segment];
    }, [])
    .join('/');
}

function createHistoryScript(tabId: number): string {
  return `<script>(()=>{
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
}

function findHtmlEntry(
  project: PreviewProject,
  language: PreviewLanguage,
  activeDirectory: string
) {
  const files = project.files;
  return (
    files.find((file) => file.path.toLowerCase() === 'index.html') ??
    files.find(
      (file) =>
        file.path.toLowerCase() ===
        `${activeDirectory ? `${activeDirectory}/` : ''}index.html`.toLowerCase()
    ) ??
    files.find(
      (file) => file.path === project.activeFilePath && language === 'html'
    ) ??
    files.find((file) => file.path.toLowerCase().endsWith('/index.html'))
  );
}

function inlineStylesheetTag(
  tag: string,
  htmlEntryPath: string,
  files: Map<string, string>
): string {
  const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!href || /^(?:[a-z]+:|\/\/|data:|#)/i.test(href)) return tag;
  const css = files.get(resolveRoomPath(htmlEntryPath, href).toLowerCase());
  if (css === undefined) return tag;
  const media = tag.match(/\bmedia\s*=\s*(["'])(.*?)\1/i)?.[2];
  const mediaAttribute = media ? ` media="${media}"` : '';
  return `<style${mediaAttribute}>${escapeStyle(css)}</style>`;
}

function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function inlineScriptTag(
  tag: string,
  project: PreviewProject,
  htmlEntryPath: string,
  files: Map<string, string>,
  javascriptOverride: string | undefined
): string {
  const src = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!src || /^(?:[a-z]+:|\/\/|data:|#)/i.test(src)) return tag;
  const scriptPath = resolveRoomPath(htmlEntryPath, src);
  const script = resolveScriptContent(
    scriptPath,
    project.activeFilePath,
    files,
    javascriptOverride
  );
  if (script === undefined) return tag;
  const attributes = (tag.match(/^<script\b([^>]*)>/i)?.[1] ?? '')
    .replace(/\bsrc\s*=\s*(["']).*?\1/i, '')
    .replace(/\s+$/, '');
  const attributeText = attributes ? ` ${attributes}` : '';
  return `<script${attributeText}>${escapeScript(script)}</script>`;
}

function resolveScriptContent(
  scriptPath: string,
  activeFilePath: string,
  files: Map<string, string>,
  javascriptOverride: string | undefined
): string | undefined {
  if (
    scriptPath.toLowerCase() === activeFilePath.toLowerCase() &&
    javascriptOverride !== undefined
  ) {
    return javascriptOverride;
  }
  return files.get(scriptPath.toLowerCase());
}

function escapeScript(script: string): string {
  return script.replace(/<\/script/gi, '<\\/script');
}

function createHtmlDocument(html: string, injection: string): string {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (head) => `${head}${injection}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (root) => `${root}<head>${injection}</head>`);
  }
  return `<!doctype html><html><head>${injection}</head><body>${html}</body></html>`;
}

function collectStyles(project: PreviewProject): string {
  return project.files
    .filter((file) => file.path.toLowerCase().endsWith('.css'))
    .map((file) => `<style>${escapeStyle(file.content)}</style>`)
    .join('');
}

export function createPreviewDocument(
  project: PreviewProject,
  language: PreviewLanguage,
  javascriptOverride: string | undefined,
  tabId: number
): string {
  const files = new Map(
    project.files.map((file) => [file.path.toLowerCase(), file.content])
  );
  const activeDirectory = project.activeFilePath.split('/').slice(0, -1).join('/');
  const htmlEntry = findHtmlEntry(project, language, activeDirectory);
  const injection = `${PREVIEW_POLICY}${createHistoryScript(tabId)}`;

  if (htmlEntry) {
    const html = htmlEntry.content
      .replace(/<link\b(?=[^>]*\brel\s*=\s*["']stylesheet["'])[^>]*>/gi, (tag) =>
        inlineStylesheetTag(tag, htmlEntry.path, files)
      )
      .replace(/<script\b(?=[^>]*\bsrc\s*=)[^>]*>\s*<\/script\s*>/gi, (tag) =>
        inlineScriptTag(tag, project, htmlEntry.path, files, javascriptOverride)
      );
    return createHtmlDocument(html, injection);
  }

  const source = javascriptOverride ?? project.source;
  const styles = collectStyles(project);
  if (language === 'css') {
    const css = styles || `<style>${escapeStyle(source)}</style>`;
    return `<!doctype html><html><head>${injection}${css}</head><body></body></html>`;
  }
  return `<!doctype html><html><head>${injection}${styles}</head><body><script>${escapeScript(source)}</script></body></html>`;
}
