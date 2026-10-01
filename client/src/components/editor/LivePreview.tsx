import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { PreviewLanguage } from './languageModes';

interface LivePreviewProps {
  source: string;
  language: PreviewLanguage;
  monaco: Monaco | null;
  editor: MonacoEditor.IStandaloneCodeEditor | null;
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

const CONTENT_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

function createPreviewDocument(
  source: string,
  language: LivePreviewProps['language']
): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_POLICY}">`;

  if (language === 'html') {
    if (/<head\b[^>]*>/i.test(source)) {
      return source.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`);
    }
    return `<!doctype html><html><head>${policy}</head><body>${source}</body></html>`;
  }

  if (language === 'css') {
    return `<!doctype html><html><head>${policy}<style>${source.replace(/<\/style/gi, '<\\/style')}</style></head><body></body></html>`;
  }

  const safeScript = source.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head>${policy}</head><body><script>${safeScript}</script></body></html>`;
}

export function LivePreview({
  source,
  language,
  monaco,
  editor,
}: LivePreviewProps) {
  const [compiled, setCompiled] = useState({ source: '', javascript: '' });

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

  return (
    <section className="live-preview" aria-label="Live preview">
      <iframe
        title="Live code preview"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={createPreviewDocument(previewSource, language)}
      />
    </section>
  );
}
