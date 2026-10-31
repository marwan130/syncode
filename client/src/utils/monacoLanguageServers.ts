import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { createWebSocketConnection, listen } from 'vscode-ws-jsonrpc';
type MessageConnection = ReturnType<typeof createWebSocketConnection>;
import type { LanguageMode } from '../components/editor/languageModes';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import { getAutocompleteEnabled } from './autocompletePreference';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import { languageForFileName } from '../components/editor/languageModes';

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
}

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind?: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  filterText?: string;
  sortText?: string;
  textEdit?: { range: LspRange; newText: string };
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

interface ManagedDocument {
  fileId: string;
  uri: string;
  content: string;
  version: number;
  models: Map<string, { model: monaco.editor.ITextModel; references: number }>;
}

interface ModelBinding {
  client: RoomLanguageServerClient;
  document: ManagedDocument;
}

const clientsByProvider = new WeakMap<
  SignalRCrdtProvider,
  Map<LanguageMode, RoomLanguageServerClient>
>();
const bindingsByModel = new Map<string, ModelBinding>();
const configuredMonaco = new WeakSet<object>();

export async function connectModelToLanguageServer(
  monacoApi: Monaco,
  provider: SignalRCrdtProvider,
  language: LanguageMode,
  model: monaco.editor.ITextModel,
  fileId: string,
  filePath: string
): Promise<() => void> {
  if (language === 'javascript' || language === 'typescript') return () => {};
  configureLanguageServerProviders(monacoApi);
  const clients =
    clientsByProvider.get(provider) ??
    new Map<LanguageMode, RoomLanguageServerClient>();
  clientsByProvider.set(provider, clients);
  let client = clients.get(language);
  if (!client) {
    client = new RoomLanguageServerClient(provider, language, monacoApi, () =>
      clients.delete(language)
    );
    clients.set(language, client);
  }

  await client.connect();
  const document = client.openDocument(model, fileId, filePath);
  bindingsByModel.set(model.uri.toString(), { client, document });
  return () => client?.closeDocument(document.uri, model);
}

export function isLanguageServerConnected(
  model: monaco.editor.ITextModel
): boolean {
  return bindingsByModel.has(model.uri.toString());
}

class RoomLanguageServerClient {
  private readonly provider: SignalRCrdtProvider;
  private readonly language: LanguageMode;
  private readonly monacoApi: Monaco;
  private readonly onClose: () => void;
  private connection: MessageConnection | null = null;
  private socket: WebSocket | null = null;
  private connectionPromise: Promise<void> | null = null;
  private documents = new Map<string, ManagedDocument>();
  private workspaceSubscriptions: Array<() => void> = [];
  private activeModels = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private constructorDisposed = false;

  constructor(
    provider: SignalRCrdtProvider,
    language: LanguageMode,
    monacoApi: Monaco,
    onClose: () => void
  ) {
    this.provider = provider;
    this.language = language;
    this.monacoApi = monacoApi;
    this.onClose = onClose;
  }

  async connect(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.connection) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.openConnection();
    try {
      await this.connectionPromise;
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.connectionPromise = null;
    }
  }

  openDocument(
    model: monaco.editor.ITextModel,
    fileId: string,
    filePath: string
  ): ManagedDocument {
    const uri = toWorkspaceUri(filePath);
    let document = this.documents.get(uri);
    if (!document) {
      document = this.createDocument(fileId, uri, model.getValue());
      this.documents.set(uri, document);
      this.sendOpenDocument(document);
    }
    const modelId = model.uri.toString();
    const modelReference = document.models.get(modelId);
    if (modelReference) modelReference.references++;
    else document.models.set(modelId, { model, references: 1 });
    bindingsByModel.set(modelId, { client: this, document });
    this.activeModels++;
    return document;
  }

  closeDocument(uri: string, model: monaco.editor.ITextModel): void {
    const document = this.documents.get(uri);
    if (!document) return;
    const modelId = model.uri.toString();
    const reference = document.models.get(modelId);
    if (reference && --reference.references === 0) {
      document.models.delete(modelId);
      bindingsByModel.delete(modelId);
      this.clearDiagnostics(reference.model);
    }
    this.activeModels = Math.max(0, this.activeModels - 1);
    if (this.activeModels === 0 && !this.idleTimer)
      this.idleTimer = setTimeout(() => this.dispose(), 500);
  }

  dispose(): void {
    if (this.constructorDisposed) return;
    this.constructorDisposed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const unsubscribe of this.workspaceSubscriptions) unsubscribe();
    this.workspaceSubscriptions = [];
    for (const document of this.documents.values()) {
      for (const { model } of document.models.values()) {
        bindingsByModel.delete(model.uri.toString());
        this.clearDiagnostics(model);
      }
      void this.connection?.sendNotification('textDocument/didClose', {
        textDocument: { uri: document.uri },
      });
    }
    this.documents.clear();
    if (this.connection) {
      void this.connection.sendNotification('exit');
      this.connection.dispose();
      this.connection = null;
    }
    this.socket?.close();
    this.socket = null;
    this.onClose();
  }

  private async openConnection(): Promise<void> {
    const socketUrl = await this.provider.createLanguageServerSocket(
      this.language
    );
    const socket = new WebSocket(socketUrl);
    this.socket = socket;
    const connection = await new Promise<MessageConnection>(
      (resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error('Language service did not connect.')),
          15_000
        );
        socket.addEventListener(
          'error',
          () => {
            window.clearTimeout(timeout);
            reject(new Error('Language service could not connect.'));
          },
          { once: true }
        );
        listen({
          webSocket: socket,
          onConnection: (connected) => {
            window.clearTimeout(timeout);
            resolve(connected);
          },
        });
      }
    );
    this.connection = connection;
    connection.listen();
    connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
        const document = this.documents.get(params.uri);
        if (document) this.publishDiagnostics(document, params.diagnostics);
      }
    );
    connection.onRequest(
      'workspace/configuration',
      (params: { items?: unknown[] }) => (params.items ?? []).map(() => null)
    );
    connection.onRequest('workspace/workspaceFolders', () => [
      { uri: 'file:///workspace', name: 'workspace' },
    ]);
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);

    await connection.sendRequest('initialize', {
      processId: null,
      clientInfo: { name: 'Syncode', version: '1.0' },
      rootUri: 'file:///workspace',
      workspaceFolders: [{ uri: 'file:///workspace', name: 'workspace' }],
      capabilities: {
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: { relatedInformation: true },
          formatting: { dynamicRegistration: false },
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
      initializationOptions: {},
    });
    await connection.sendNotification('initialized', {});
    this.workspaceSubscriptions.push(
      this.provider.onFileContentChange((fileId) => this.syncFile(fileId)),
      this.provider.onFilesChange(() => this.syncWorkspace())
    );
    this.syncWorkspace();
    socket.addEventListener('close', () => this.dispose(), { once: true });
  }

  private sendOpenDocument(document: ManagedDocument): void {
    void this.connection?.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: document.uri,
        languageId: this.language,
        version: document.version,
        text: document.content,
      },
    });
  }

  private publishDiagnostics(
    document: ManagedDocument,
    diagnostics: LspDiagnostic[]
  ): void {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map(
      (diagnostic) => ({
        severity:
          diagnostic.severity === 1
            ? this.monacoApi.MarkerSeverity.Error
            : diagnostic.severity === 2
              ? this.monacoApi.MarkerSeverity.Warning
              : diagnostic.severity === 3
                ? this.monacoApi.MarkerSeverity.Info
                : this.monacoApi.MarkerSeverity.Hint,
        message: diagnostic.message,
        code: diagnostic.code?.toString(),
        source: diagnostic.source ?? 'Language server',
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
      })
    );
    for (const { model } of document.models.values())
      this.monacoApi.editor.setModelMarkers(model, 'syncode-lsp', markers);
  }

  private clearDiagnostics(model: monaco.editor.ITextModel): void {
    this.monacoApi.editor.setModelMarkers(model, 'syncode-lsp', []);
  }

  private createDocument(
    fileId: string,
    uri: string,
    content: string
  ): ManagedDocument {
    return { fileId, uri, content, version: 1, models: new Map() };
  }

  private syncWorkspace(): void {
    if (!this.connection) return;
    const existingUris = new Set<string>();
    for (const entry of this.provider.fileList.filter(
      (item) =>
        !item.isFolder && languageForFileName(item.name) === this.language
    )) {
      const uri = this.workspaceUri(entry.id);
      if (!uri) continue;
      existingUris.add(uri);
      this.syncFile(entry.id);
    }
    for (const uri of this.documents.keys())
      if (!existingUris.has(uri)) this.closeWorkspaceDocument(uri);
  }

  private syncFile(fileId: string): void {
    if (!this.connection) return;
    const entry = this.provider.fileList.find(
      (item) => item.id === fileId && !item.isFolder
    );
    if (!entry || languageForFileName(entry.name) !== this.language) return;
    const filePath = getEntryPath(entry, this.provider.fileList);
    if (!filePath) return;
    const uri = toWorkspaceUri(filePath);
    const content = this.provider.getFileContent(fileId);
    const document = this.documents.get(uri);
    if (!document)
      return this.openWorkspaceDocument(fileId, uri, filePath, content);
    this.updateWorkspaceDocument(document, fileId, uri, content);
  }

  private workspaceUri(fileId: string): string | null {
    const entry = this.provider.fileList.find((item) => item.id === fileId);
    const filePath = entry && getEntryPath(entry, this.provider.fileList);
    return filePath ? toWorkspaceUri(filePath) : null;
  }

  private openWorkspaceDocument(
    fileId: string,
    uri: string,
    filePath: string,
    content: string
  ): void {
    const document = this.createDocument(fileId, uri, content);
    const model = this.monacoApi.editor
      .getModels()
      .find((item: monaco.editor.ITextModel) =>
        item.uri.path.endsWith(`/${filePath}`)
      );
    if (model)
      document.models.set(model.uri.toString(), { model, references: 0 });
    this.documents.set(uri, document);
    this.sendOpenDocument(document);
  }

  private updateWorkspaceDocument(
    document: ManagedDocument,
    fileId: string,
    uri: string,
    content: string
  ): void {
    document.fileId = fileId;
    if (document.content === content) return;
    document.content = content;
    document.version++;
    void this.connection?.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: document.version },
      contentChanges: [{ text: content }],
    });
  }

  private closeWorkspaceDocument(uri: string): void {
    const document = this.documents.get(uri);
    if (document) {
      for (const { model } of document.models.values()) {
        bindingsByModel.delete(model.uri.toString());
        this.clearDiagnostics(model);
      }
    }
    this.documents.delete(uri);
    void this.connection?.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.connection) return Promise.resolve(null);
    return this.connection.sendRequest(method, params);
  }

  resolveMonacoUri(uri: string): monaco.Uri {
    const lspUri = this.monacoApi.Uri.parse(uri);
    const filePath = decodeURIComponent(lspUri.path).replace(
      /^\/workspace\//,
      ''
    );
    const model = this.monacoApi.editor
      .getModels()
      .find((item: monaco.editor.ITextModel) =>
        item.uri.path.endsWith(`/${filePath}`)
      );
    return model?.uri ?? lspUri;
  }
}

function configureLanguageServerProviders(monacoApi: Monaco): void {
  if (configuredMonaco.has(monacoApi)) return;
  configuredMonaco.add(monacoApi);

  for (const language of [
    'html',
    'css',
    'python',
    'csharp',
    'c',
    'cpp',
    'rust',
    'java',
  ] as LanguageMode[]) {
    monacoApi.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '<', '"', "'", '/', '#'],
      provideCompletionItems: async (
        model: monaco.editor.ITextModel,
        position: monaco.Position
      ) => {
        if (!getAutocompleteEnabled()) return { suggestions: [] };
        const result = await requestForModel<
          { items?: LspCompletionItem[] } | LspCompletionItem[]
        >(model, 'textDocument/completion', {
          position: toLspPosition(position),
          context: { triggerKind: 1 },
        });
        const items = Array.isArray(result) ? result : (result?.items ?? []);
        const word = model.getWordUntilPosition(position);
        const range = new monacoApi.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );
        return {
          suggestions: items.map((item) =>
            toMonacoCompletionItem(monacoApi, item, range)
          ),
        };
      },
    });

    monacoApi.languages.registerHoverProvider(language, {
      provideHover: async (
        model: monaco.editor.ITextModel,
        position: monaco.Position
      ) => {
        const result = await requestForModel<{
          contents?:
            | string
            | { kind?: string; value: string }
            | Array<string | { language?: string; value: string }>;
        }>(model, 'textDocument/hover', { position: toLspPosition(position) });
        const contents = result?.contents;
        if (!contents) return null;
        const values = Array.isArray(contents) ? contents : [contents];
        return {
          contents: values.map((value) => ({
            value: typeof value === 'string' ? value : value.value,
          })),
        };
      },
    });

    monacoApi.languages.registerDefinitionProvider(language, {
      provideDefinition: async (
        model: monaco.editor.ITextModel,
        position: monaco.Position
      ) => {
        const result = await requestForModel<LspLocation | LspLocation[]>(
          model,
          'textDocument/definition',
          { position: toLspPosition(position) }
        );
        if (!result) return null;
        return (Array.isArray(result) ? result : [result]).map((location) => ({
          uri:
            bindingsByModel
              .get(model.uri.toString())
              ?.client.resolveMonacoUri(location.uri) ??
            monacoApi.Uri.parse(location.uri),
          range: toMonacoRange(monacoApi, location.range),
        }));
      },
    });

    monacoApi.languages.registerDocumentSymbolProvider(language, {
      provideDocumentSymbols: async (model: monaco.editor.ITextModel) => {
        const symbols = await requestForModel<LspDocumentSymbol[]>(
          model,
          'textDocument/documentSymbol'
        );
        return (symbols ?? []).map((symbol) =>
          toMonacoDocumentSymbol(monacoApi, symbol)
        );
      },
    });

    monacoApi.languages.registerDocumentFormattingEditProvider(language, {
      provideDocumentFormattingEdits: async (
        model: monaco.editor.ITextModel,
        options: monaco.languages.FormattingOptions
      ) => {
        const edits = await requestForModel<
          Array<{ range: LspRange; newText: string }>
        >(model, 'textDocument/formatting', {
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        });
        return (edits ?? []).map((edit) => ({
          range: toMonacoRange(monacoApi, edit.range),
          text: edit.newText,
        }));
      },
    });
  }
}

async function requestForModel<T>(
  model: monaco.editor.ITextModel,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T | null> {
  const binding = bindingsByModel.get(model.uri.toString());
  if (!binding) return null;
  try {
    return (await binding.client.request(method, {
      textDocument: { uri: binding.document.uri },
      ...params,
    })) as T | null;
  } catch {
    return null;
  }
}

function toLspPosition(position: monaco.Position): {
  line: number;
  character: number;
} {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function toMonacoCompletionItem(
  monacoApi: Monaco,
  item: LspCompletionItem,
  fallbackRange: monaco.Range
): monaco.languages.CompletionItem {
  const documentation =
    typeof item.documentation === 'string'
      ? item.documentation
      : item.documentation?.value;
  return {
    label: item.label,
    kind: mapCompletionKind(monacoApi, item.kind),
    detail: item.detail,
    documentation,
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    insertTextRules:
      item.insertTextFormat === 2
        ? monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    filterText: item.filterText,
    sortText: item.sortText,
    range: item.textEdit
      ? toMonacoRange(monacoApi, item.textEdit.range)
      : fallbackRange,
  };
}

function mapCompletionKind(
  monacoApi: Monaco,
  kind?: number
): monaco.languages.CompletionItemKind {
  const values = monacoApi.languages.CompletionItemKind;
  if (kind === undefined) return values.Text;
  const map: Partial<Record<number, monaco.languages.CompletionItemKind>> = {
    1: values.Text,
    2: values.Method,
    3: values.Function,
    4: values.Constructor,
    5: values.Field,
    6: values.Variable,
    7: values.Class,
    8: values.Interface,
    9: values.Module,
    10: values.Property,
    12: values.Value,
    13: values.Enum,
    14: values.Keyword,
    15: values.Snippet,
    17: values.File,
    18: values.Reference,
    21: values.Constant,
    22: values.Struct,
    23: values.Event,
    24: values.Operator,
    25: values.TypeParameter,
  };
  return map[kind] ?? values.Text;
}

function toMonacoRange(monacoApi: Monaco, range: LspRange): monaco.Range {
  return new monacoApi.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  );
}

function toMonacoDocumentSymbol(
  monacoApi: Monaco,
  symbol: LspDocumentSymbol
): monaco.languages.DocumentSymbol {
  const kinds = monacoApi.languages.SymbolKind;
  const kind = kinds[symbol.kind] ?? kinds.String;
  return {
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind,
    tags: [],
    range: toMonacoRange(monacoApi, symbol.range),
    selectionRange: toMonacoRange(monacoApi, symbol.selectionRange),
    children: (symbol.children ?? []).map((child) =>
      toMonacoDocumentSymbol(monacoApi, child)
    ),
  };
}

function toWorkspaceUri(filePath: string): string {
  const path = filePath.split('/').map(encodeURIComponent).join('/');
  return `file:///workspace/${path}`;
}
