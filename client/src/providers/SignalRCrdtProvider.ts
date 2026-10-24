import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { CrdtDocument } from '../crdt/CrdtDocument';
import type { CrdtId } from '../crdt/CrdtId';
import type { InsertOp, DeleteOp, CrdtOp } from '../crdt/CrdtDocument';
import { PendingBuffer } from '../crdt/PendingBuffer';
import type { CursorAnchor } from '../crdt/CursorAnchor';
import { ProjectTree } from '../crdt/ProjectTree';
import type { ProjectTreeOperation } from '../crdt/ProjectTree';
import {
  listPendingProjectTreeOperations,
  migratePendingProjectTreeOperations,
  removePendingProjectTreeOperation,
  savePendingProjectTreeOperation,
  validatePendingProjectTreeOperations,
} from '../crdt/pendingProjectTreeOutbox';
import type { ImportedFileContent } from '../import/folderImport';
import {
  prepareProjectImport,
} from '../import/folderImport';
import { compressCrdtSnapshot, decompressCrdtSnapshot } from '../crdt/snapshotCompression';
import type { GithubRepositoryBaseline } from '../github/githubTypes';
import {
  normalizeChatMessage,
  normalizeParticipant,
} from './serverMessageNormalization';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'awaiting-approval'
  | 'join-rejected';

export interface RoomJoinRequest {
  requestId: string;
  displayName: string;
  color: string;
  avatarUrl?: string;
}

export interface AwarenessState {
  cursor: CursorAnchor | null;
  name: string;
  color: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ParticipantInfo {
  connectionId: string;
  displayName: string;
  color: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ChatMessage {
  id: string;
  author: string;
  color: string;
  content: string;
  sentAt: string;
}

export type ExecutionLanguage =
  | 'JavaScript'
  | 'TypeScript'
  | 'Python'
  | 'CSharp'
  | 'C'
  | 'Cpp'
  | 'Rust'
  | 'Java';

export interface ExecutionEvent {
  roomId: string;
  jobId: string;
  requestId: string;
  type: 'output' | 'completed' | 'failed';
  stream?: 'stdout' | 'stderr';
  text?: string;
  exitCode?: number;
  timedOut?: boolean;
  outputLimitExceeded?: boolean;
}

export interface ExecutionProjectFile {
  path: string;
  content: string;
}

export interface ExecutionSubmission {
  jobId: string;
  queuePosition: number;
}

export interface TerminalSessionStart {
  sessionId: string;
}

export interface TerminalOutput {
  text: string;
  offset: number;
  exited: boolean;
  exitCode: number | null;
}

export interface RoomEntry {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
}

export class SignalRCrdtProvider {
  private documents = new Map<string, CrdtDocument>();
  private buffers = new Map<string, PendingBuffer>();
  private activeFile = '';
  private files: RoomEntry[] = [];
  private projectTree: ProjectTree;
  private pendingTreeOperations: ProjectTreeOperation[] = [];
  private readonly pendingTreeReady: Promise<void>;
  private treeFlushPromise: Promise<void> | null = null;
  private roomParticipants: ParticipantInfo[] = [];
  private githubRepositoryBaseline: GithubRepositoryBaseline | null = null;
  private localEditLocked = false;
  private fileListeners = new Set<(files: RoomEntry[]) => void>();
  private activeFileListeners = new Set<(file: RoomEntry) => void>();
  public get fileList(): RoomEntry[] {
    return this.files;
  }
  public get activeFileId(): string {
    return this.activeFile;
  }
  public get isEditLocked(): boolean {
    return this.localEditLocked;
  }
  public setLocalColor(color: string): void {
    if (this.color === color) return;
    this.color = color;
    if (this.connection.state === HubConnectionState.Connected) {
      this.connection
        .invoke('UpdateParticipantColor', this.roomId, color)
        .catch(() => { });
    }
    this.sendAwareness({
      cursor: null,
      name: this.displayName,
      color,
    }).catch(() => { });
  }

  public setLocalAvatarUrl(avatarUrl?: string): void {
    if (this.avatarUrl === avatarUrl) return;
    this.avatarUrl = avatarUrl;
    if (this.connection.state === HubConnectionState.Connected)
      this.connection
        .invoke('UpdateParticipantAvatar', avatarUrl ?? null)
        .catch(() => { });
  }
  public getFileContent(fileId: string): string {
    return this.documentFor(fileId).toVisibleString();
  }
  public getDocument(fileId: string): CrdtDocument {
    return this.documentFor(fileId);
  }
  public readonly siteId: string;
  private connection: HubConnection;
  private roomId: string;
  private accessKey: string;
  private creatorToken: string | null;
  private displayName: string;
  private color: string;
  private avatarUrl?: string;
  private statusListeners: Set<(s: ConnectionStatus) => void> = new Set();
  private changeListeners: Set<() => void> = new Set();
  private awarenessListeners: Set<
    (peerId: string, state: AwarenessState) => void
  > = new Set();
  private snapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private snapshotLoadQueue = Promise.resolve();
  private roomParticipantsListeners: Set<
    (participants: ParticipantInfo[]) => void
  > = new Set();
  private chatMessageListeners = new Set<(message: ChatMessage) => void>();
  private chatHistoryListeners = new Set<(messages: ChatMessage[]) => void>();
  private executionEventListeners = new Set<(event: ExecutionEvent) => void>();
  private roomKickedListeners = new Set<() => void>();
  private roomJoinRequests: RoomJoinRequest[] = [];
  private roomJoinRequestsListeners = new Set<(requests: RoomJoinRequest[]) => void>();
  private joinRejected = false;
  private roomJoined = false;
  private githubRepositoryListeners = new Set<
    (baseline: GithubRepositoryBaseline | null) => void
  >();

  constructor(
    siteId: string,
    roomId: string,
    accessKey: string,
    serverUrl: string,
    displayName: string = `User ${siteId.slice(0, 6)}`,
    color: string = '#38bdf8',
    creatorToken: string | null = null
  ) {
    this.siteId = siteId;
    this.roomId = roomId;
    this.accessKey = accessKey;
    this.creatorToken = creatorToken;
    this.displayName = displayName;
    this.color = color;
    this.projectTree = ProjectTree.fromEntries(siteId, this.files);
    this.pendingTreeReady = this.loadPendingTreeOperations();

    this.connection = new HubConnectionBuilder()
      .withUrl(`${serverUrl}/collabhub`)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.registerHubHandlers();
  }

  public get connectionId(): string | null {
    return this.connection.connectionId;
  }

  public async connect(): Promise<void> {
    this.emitStatus('connecting');
    try {
      await this.pendingTreeReady;
      await this.connection.start();
      const joined = await this.joinCurrentRoom();
      this.emitStatus(this.roomJoined || joined ? 'connected' : 'awaiting-approval');
    } catch (err) {
      if (this.connection.state !== HubConnectionState.Disconnected) {
        await this.connection.stop().catch(() => { });
      }
      this.emitStatus('disconnected');
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    const pendingFiles = [...this.snapshotSaveTimers.keys()];
    this.snapshotSaveTimers.forEach((timer) => clearTimeout(timer));
    this.snapshotSaveTimers.clear();
    if (this.connection.state === HubConnectionState.Connected) {
      await Promise.all(
        pendingFiles.map((fileId) => this.saveFileSnapshot(fileId).catch(() => { }))
      );
    }
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
    this.emitStatus('disconnected');
  }

  public localInsert(
    originId: CrdtId | null,
    value: string,
    fileId = this.activeFile
  ): InsertOp {
    const op = this.documentFor(fileId).localInsert(originId, value);
    this.emitChange();
    this.sendOp(fileId, op).catch(() => { });
    this.scheduleSnapshotSave(fileId);
    return op;
  }

  private documentFor(fileId: string): CrdtDocument {
    if (!fileId) throw new Error('A file must be selected.');
    let doc = this.documents.get(fileId);
    if (!doc) {
      doc = new CrdtDocument(this.siteId);
      this.documents.set(fileId, doc);
      this.buffers.set(fileId, new PendingBuffer(doc));
    }
    return doc;
  }

  public setActiveFile(fileId: string): void {
    const file = this.files.find(
      (item) => item.id === fileId && !item.isFolder
    );
    if (!file || fileId === this.activeFile) return;
    this.activeFile = fileId;
    this.documentFor(fileId);
    this.activeFileListeners.forEach((listener) => listener(file));
    this.emitChange();
  }

  public onFilesChange(listener: (files: RoomEntry[]) => void): () => void {
    this.fileListeners.add(listener);
    listener(this.files);
    return () => this.fileListeners.delete(listener);
  }

  public onActiveFileChange(listener: (file: RoomEntry) => void): () => void {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
  }

  public async createEntry(
    name: string,
    parentId: string | null,
    isFolder: boolean
  ): Promise<string> {
    const id = crypto.randomUUID().replaceAll('-', '');
    const operation = this.projectTree.createEntry({
      id,
      name,
      parentId,
      isFolder,
    });
    await this.submitTreeOperation(operation);
    if (!isFolder) this.setActiveFile(id);
    return id;
  }
  public async renameEntry(entryId: string, name: string): Promise<void> {
    const operation = this.projectTree.renameEntry(entryId, name);
    await this.submitTreeOperation(operation);
  }
  public async moveEntry(
    entryId: string,
    parentId: string | null
  ): Promise<void> {
    const operation = this.projectTree.moveEntry(entryId, parentId);
    await this.submitTreeOperation(operation);
  }
  public async deleteEntry(entryId: string): Promise<void> {
    const operation = this.projectTree.deleteEntry(entryId);
    await this.submitTreeOperation(operation);
  }

  public async importProjectFiles(
    files: ImportedFileContent[],
    repositoryBaseline: GithubRepositoryBaseline | null = null
  ): Promise<void> {
    this.validateProjectImportAccess();
    await this.flushTreeOperations();
    const importedFiles = await prepareProjectImport(files, this.siteId);

    const importId = crypto.randomUUID().replaceAll('-', '');
    const operations = await this.connection.invoke<ProjectTreeOperation[]>(
      'ImportProject',
      this.roomId,
      importId,
      importedFiles.map(({ path, id, compressedSnapshot }) => ({
        path,
        id,
        compressedSnapshot,
      })),
      repositoryBaseline
    );

    for (const operation of operations) this.applyTreeOperation(operation);
    for (const file of importedFiles) {
      const document = this.documentFor(file.id);
      document.fromSnapshot(await decompressCrdtSnapshot(file.compressedSnapshot));
      this.buffers.get(file.id)?.processPending();
    }
    if (importedFiles[0]) this.setActiveFile(importedFiles[0].id);
    this.emitChange();
  }

  private validateProjectImportAccess(): void {
    if (this.localEditLocked)
      throw new Error('The room admin has locked your editing access.');
    const participant = this.roomParticipants.find(
      (candidate) =>
        candidate.connectionId === this.connection.connectionId &&
        candidate.isAdmin
    );
    if (!participant)
      throw new Error('Only room admins can import a folder.');
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Connect to the room before importing a folder.');
  }

  public async createGithubRepositoryAdminGrant(): Promise<string> {
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Connect to the room before importing a repository.');
    return this.connection.invoke<string>(
      'CreateGithubRepositoryAdminGrant',
      this.roomId
    );
  }
  public async toggleParticipantEditLock(connectionId: string): Promise<void> {
    await this.connection.invoke(
      'ToggleParticipantEditLock',
      this.roomId,
      connectionId
    );
  }
  public async setParticipantAdmin(
    connectionId: string,
    isAdmin: boolean
  ): Promise<void> {
    await this.connection.invoke(
      'SetParticipantAdmin',
      this.roomId,
      connectionId,
      isAdmin
    );
  }

  public async kickParticipant(connectionId: string): Promise<void> {
    await this.connection.invoke('KickParticipant', this.roomId, connectionId);
  }

  private updateFiles(files: RoomEntry[]): void {
    this.removeStaleFileState(files);
    this.files = files;
    this.initializeFileDocuments(files);
    this.reconcileActiveFile(files);
    this.publishFileUpdates(files);
  }

  private removeStaleFileState(files: RoomEntry[]): void {
    const nextIds = new Set(files.map((entry) => entry.id));
    for (const oldEntry of this.files) {
      if (nextIds.has(oldEntry.id)) continue;
      this.documents.delete(oldEntry.id);
      this.buffers.delete(oldEntry.id);
      const timer = this.snapshotSaveTimers.get(oldEntry.id);
      if (timer) clearTimeout(timer);
      this.snapshotSaveTimers.delete(oldEntry.id);
    }
  }

  private initializeFileDocuments(files: RoomEntry[]): void {
    for (const file of files) {
      if (!file.isFolder) this.documentFor(file.id);
    }
  }

  private reconcileActiveFile(files: RoomEntry[]): void {
    const activeFile = files.find(
      (file) => file.id === this.activeFile && !file.isFolder
    );
    if (!activeFile)
      this.activeFile = files.find((file) => !file.isFolder)?.id ?? '';
  }

  private publishFileUpdates(files: RoomEntry[]): void {
    this.fileListeners.forEach((listener) => listener([...files]));
    const active = files.find((file) => file.id === this.activeFile);
    if (active)
      this.activeFileListeners.forEach((listener) => listener(active));
    this.emitChange();
  }

  private applyTreeOperation(operation: ProjectTreeOperation): void {
    this.projectTree.applyOperation(operation);
    this.updateFiles(this.projectTree.getEntries());
  }

  private async submitTreeOperation(
    operation: ProjectTreeOperation
  ): Promise<void> {
    await this.pendingTreeReady;
    if (
      !this.pendingTreeOperations.some(
        (pending) =>
          pending.opId.siteId === operation.opId.siteId &&
          pending.opId.counter === operation.opId.counter
      )
    ) {
      await savePendingProjectTreeOperation(this.roomId, operation);
      this.pendingTreeOperations.push(operation);
    }
    this.applyTreeOperation(operation);
    await this.flushTreeOperations();
  }

  private flushTreeOperations(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected)
      return Promise.resolve();
    if (this.treeFlushPromise) return this.treeFlushPromise;
    this.treeFlushPromise = this.syncPendingTreeOperations().finally(() => {
      this.treeFlushPromise = null;
    });
    return this.treeFlushPromise;
  }

  private async syncPendingTreeOperations(): Promise<void> {
    while (
      this.pendingTreeOperations.length > 0 &&
      this.connection.state === HubConnectionState.Connected
    ) {
      await this.syncPendingTreeOperation(this.pendingTreeOperations[0]);
    }
  }

  private async syncPendingTreeOperation(
    operation: ProjectTreeOperation
  ): Promise<void> {
    try {
      await this.connection.invoke(
        'ApplyProjectTreeOperation',
        this.roomId,
        operation
      );
    } catch (error) {
      if (this.connection.state === HubConnectionState.Connected)
        await this.discardPendingTreeOperation(operation, true);
      console.error(
        '[SignalRCrdtProvider] Failed to sync project tree operation:',
        errorMessage(error)
      );
      throw error;
    }
    await this.discardPendingTreeOperation(operation);
  }

  private async discardPendingTreeOperation(
    operation: ProjectTreeOperation,
    rollback = false
  ): Promise<void> {
    if (rollback) this.projectTree.removeOperation(operation.opId);
    this.pendingTreeOperations = this.pendingTreeOperations.filter(
      (pending) =>
        pending.opId.siteId !== operation.opId.siteId ||
        pending.opId.counter !== operation.opId.counter
    );
    await removePendingProjectTreeOperation(this.roomId, operation).catch(
      () => { }
    );
    if (rollback) this.updateFiles(this.projectTree.getEntries());
  }

  private pendingTreeStorageKey(): string {
    return `syncode:project-tree-pending:${this.roomId}`;
  }

  private async loadPendingTreeOperations(): Promise<void> {
    await migratePendingProjectTreeOperations(
      this.roomId,
      this.pendingTreeStorageKey()
    );
    const storedOperations = await listPendingProjectTreeOperations(this.roomId);
    this.pendingTreeOperations = validatePendingProjectTreeOperations(
      storedOperations
    );
    for (const operation of this.pendingTreeOperations)
      this.projectTree.applyOperation(operation);
    this.updateFiles(this.projectTree.getEntries());
  }

  public localDelete(id: CrdtId, fileId = this.activeFile): DeleteOp {
    const op = this.documentFor(fileId).localDelete(id);
    this.emitChange();
    this.sendOp(fileId, op).catch(() => { });
    this.scheduleSnapshotSave(fileId);
    return op;
  }

  private scheduleSnapshotSave(fileId: string): void {
    const existingTimer = this.snapshotSaveTimers.get(fileId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.snapshotSaveTimers.delete(fileId);
      this.saveFileSnapshot(fileId).catch(() => { });
    }, 1000);
    this.snapshotSaveTimers.set(fileId, timer);
  }

  private async saveFileSnapshot(fileId: string): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    const snapshot = await compressCrdtSnapshot(
      this.documentFor(fileId).toSnapshot()
    );
    if (this.connection.state !== HubConnectionState.Connected) return;
    await this.connection.invoke(
      'SaveFileSnapshot',
      this.roomId,
      fileId,
      snapshot.value
    );
  }

  public async sendAwareness(state: AwarenessState): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.invoke('UpdateAwareness', this.roomId, state);
    } catch (err) {
      console.error(
        '[SignalRCrdtProvider] Failed to send awareness:',
        errorMessage(err)
      );
    }
  }

  public async sendChatMessage(content: string): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    await this.connection.invoke('SendChatMessage', this.roomId, content);
  }

  public async runExecution(
    language: ExecutionLanguage,
    source: string,
    requestId: string,
    sourcePath: string,
    projectFiles: ExecutionProjectFile[]
  ): Promise<ExecutionSubmission> {
    return this.connection.invoke<ExecutionSubmission>(
      'RunExecution',
      language,
      source,
      requestId,
      sourcePath,
      projectFiles
    );
  }

  public async startTerminal(): Promise<TerminalSessionStart> {
    return this.connection.invoke<TerminalSessionStart>('StartTerminal');
  }

  public async writeExecutionInput(
    jobId: string,
    input: string
  ): Promise<void> {
    await this.connection.invoke('WriteExecutionInput', jobId, input);
  }

  public async writeTerminalInput(
    sessionId: string,
    input: string
  ): Promise<void> {
    await this.connection.invoke('WriteTerminalInput', sessionId, input);
  }

  public async readTerminalOutput(
    sessionId: string,
    offset: number
  ): Promise<TerminalOutput> {
    return this.connection.invoke<TerminalOutput>(
      'ReadTerminalOutput',
      sessionId,
      offset
    );
  }

  public async closeTerminal(sessionId: string): Promise<void> {
    await this.connection.invoke('CloseTerminal', sessionId);
  }

  public onExecutionEvent(
    listener: (event: ExecutionEvent) => void
  ): () => void {
    this.executionEventListeners.add(listener);
    return () => this.executionEventListeners.delete(listener);
  }

  public onChatMessage(listener: (message: ChatMessage) => void): () => void {
    this.chatMessageListeners.add(listener);
    return () => this.chatMessageListeners.delete(listener);
  }

  public onChatHistory(
    listener: (messages: ChatMessage[]) => void
  ): () => void {
    this.chatHistoryListeners.add(listener);
    return () => this.chatHistoryListeners.delete(listener);
  }

  public onStatusChange(listener: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public onDocumentChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  public onAwarenessUpdate(
    listener: (peerId: string, state: AwarenessState) => void
  ): () => void {
    this.awarenessListeners.add(listener);
    return () => this.awarenessListeners.delete(listener);
  }

  public onRoomParticipants(
    listener: (participants: ParticipantInfo[]) => void
  ): () => void {
    this.roomParticipantsListeners.add(listener);
    listener([...this.roomParticipants]);
    return () => this.roomParticipantsListeners.delete(listener);
  }

  public onRoomKicked(listener: () => void): () => void {
    this.roomKickedListeners.add(listener);
    return () => this.roomKickedListeners.delete(listener);
  }

  public onRoomJoinRequestsChanged(
    listener: (requests: RoomJoinRequest[]) => void
  ): () => void {
    this.roomJoinRequestsListeners.add(listener);
    listener([...this.roomJoinRequests]);
    return () => this.roomJoinRequestsListeners.delete(listener);
  }

  public approveRoomJoinRequest(requestId: string): Promise<void> {
    return this.connection.invoke('ApproveRoomJoinRequest', this.roomId, requestId);
  }

  public rejectRoomJoinRequest(requestId: string): Promise<void> {
    return this.connection.invoke('RejectRoomJoinRequest', this.roomId, requestId);
  }

  public onGithubRepositoryChange(
    listener: (baseline: GithubRepositoryBaseline | null) => void
  ): () => void {
    this.githubRepositoryListeners.add(listener);
    listener(this.githubRepositoryBaseline);
    return () => this.githubRepositoryListeners.delete(listener);
  }

  private registerHubHandlers(): void {
    this.connection.on('KickedFromRoom', () => {
      this.roomJoined = false;
      this.roomKickedListeners.forEach((listener) => listener());
      void this.connection.stop();
    });

    this.connection.on(
      'RoomJoinRequestsChanged',
      (requests: RoomJoinRequest[]) => {
        this.roomJoinRequests = requests ?? [];
        const current = [...this.roomJoinRequests];
        this.roomJoinRequestsListeners.forEach((listener) => listener(current));
      }
    );
    this.connection.on('RoomJoinApproved', async () => {
      try {
        if (await this.joinCurrentRoom()) {
          await this.flushTreeOperations();
          this.emitStatus('connected');
        }
      } catch {
        this.emitStatus('disconnected');
      }
    });
    this.connection.on('RoomJoinRejected', () => {
      this.roomJoined = false;
      this.joinRejected = true;
      this.emitStatus('join-rejected');
      void this.connection.stop();
    });

    const emitExecutionEvent = (event: ExecutionEvent) => {
      this.executionEventListeners.forEach((listener) => listener(event));
    };
    this.connection.on('ExecutionOutput', emitExecutionEvent);
    this.connection.on('ExecutionCompleted', emitExecutionEvent);
    this.connection.on('ExecutionFailed', emitExecutionEvent);

    this.connection.on('ChatMessage', (raw: Record<string, unknown>) => {
      this.chatMessageListeners.forEach((listener) =>
        listener(normalizeChatMessage(raw))
      );
    });

    this.connection.on(
      'GithubRepositoryBaseline',
      (baseline: GithubRepositoryBaseline | null) => {
        this.githubRepositoryBaseline = baseline;
        this.githubRepositoryListeners.forEach((listener) => listener(baseline));
      }
    );

    this.connection.on(
      'ChatHistory',
      (rawMessages: Array<Record<string, unknown>>) => {
        const messages = (rawMessages || []).map((message) =>
          normalizeChatMessage(message)
        );
        this.chatHistoryListeners.forEach((listener) => listener(messages));
      }
    );

    this.connection.on('RoomFiles', (files: RoomEntry[]) => {
      const localSnapshot = this.projectTree.toSnapshot();
      this.projectTree = ProjectTree.fromEntries(this.siteId, files);
      try {
        this.projectTree.fromSnapshot(localSnapshot);
      } catch {
        this.projectTree = ProjectTree.fromEntries(this.siteId, files);
      }
      this.updateFiles(this.projectTree.getEntries());
    });
    this.connection.on(
      'ProjectTreeHistory',
      (operations: ProjectTreeOperation[]) => {
        for (const operation of operations ?? [])
          this.applyTreeOperation(operation);
        void this.flushTreeOperations().catch(() => { });
      }
    );
    this.connection.on('ProjectTreeSnapshot', (snapshot: string) => {
      try {
        this.projectTree.fromSnapshot(snapshot);
        this.updateFiles(this.projectTree.getEntries());
      } catch (err) {
        console.error(
          '[SignalRCrdtProvider] Failed to load project tree snapshot:',
          errorMessage(err)
        );
      }
    });
    this.connection.on(
      'ProjectTreeOperation',
      (operation: ProjectTreeOperation) => this.applyTreeOperation(operation)
    );
    this.connection.on(
      'LoadFileSnapshot',
      (fileId: string, snapshotJson: string) => {
        this.snapshotLoadQueue = this.snapshotLoadQueue
          .then(async () => {
            const snapshot = await decompressCrdtSnapshot(snapshotJson);
            this.documentFor(fileId).fromSnapshot(snapshot);
            this.buffers.get(fileId)?.processPending();
            this.emitChange();
          })
          .catch((err) => {
            console.error(
              '[SignalRCrdtProvider] Failed to load snapshot:',
              errorMessage(err)
            );
          });
      }
    );

    this.connection.on('ReceiveFileOp', (fileId: string, op: CrdtOp) => {
      this.buffers.get(fileId)?.process(op);
      this.emitChange();
      this.scheduleSnapshotSave(fileId);
    });

    this.connection.on(
      'RequestFileSnapshot',
      (fileId: string, targetConnectionId: string) => {
        if (this.connection.state !== HubConnectionState.Connected) return;
        compressCrdtSnapshot(this.documentFor(fileId).toSnapshot())
          .then(({ value }) =>
            this.connection.invoke(
              'SendFileSnapshotToPeer',
              this.roomId,
              fileId,
              targetConnectionId,
              value
            )
          )
          .catch((err) => {
            console.error(
              '[SignalRCrdtProvider] Failed to send snapshot:',
              errorMessage(err)
            );
          });
      }
    );

    this.connection.on(
      'AwarenessUpdate',
      (peerId: string, state: AwarenessState) => {
        this.awarenessListeners.forEach((l) => l(peerId, state));
      }
    );

    this.connection.on(
      'RoomParticipants',
      (rawParticipants: Array<Record<string, unknown>>) => {
        const participants = (rawParticipants || []).map((p) =>
          normalizeParticipant(p)
        );
        this.setRoomParticipants(participants);
      }
    );

    this.connection.on('ParticipantUpdated', (raw: Record<string, unknown>) => {
      this.upsertRoomParticipant(normalizeParticipant(raw));
    });

    this.connection.on(
      'ParticipantAvatarUpdated',
      (connectionId: string, avatarUrl: string | null) => {
        const participant = this.roomParticipants.find(
          (item) => item.connectionId === connectionId
        );
        if (participant)
          this.upsertRoomParticipant({
            ...participant,
            avatarUrl: avatarUrl ?? undefined,
          });
      }
    );

    this.connection.on(
      'PeerJoined',
      (
        peerId: string,
        displayName: string,
        color: string,
        isAdmin = false,
        isLocked = false,
        avatarUrl?: string
      ) => {
        this.upsertRoomParticipant({
          connectionId: peerId,
          displayName,
          color,
          avatarUrl,
          isAdmin,
          isLocked,
        });
      }
    );

    this.connection.on('PeerLeft', (peerId: string) => {
      this.removeRoomParticipants(
        (participant) => participant.connectionId === peerId
      );
    });

    this.connection.onreconnecting(() => {
      this.roomJoined = false;
      this.emitStatus('reconnecting');
    });

    this.connection.onreconnected(async () => {
      try {
        const joined = await this.joinCurrentRoom();
        if (joined) await this.flushTreeOperations();
        this.emitStatus(this.roomJoined || joined ? 'connected' : 'awaiting-approval');
      } catch (err) {
        this.emitStatus('disconnected');
        console.error(
          '[SignalRCrdtProvider] Failed to rejoin room after reconnect:',
          errorMessage(err)
        );
        await this.connection.stop().catch(() => { });
      }
    });

    this.connection.onclose(() => {
      if (!this.joinRejected) this.emitStatus('disconnected');
    });
  }

  private setRoomParticipants(participants: ParticipantInfo[]): void {
    this.roomParticipants = participants;
    this.syncLocalEditLock();
    this.publishRoomParticipants();
  }

  private upsertRoomParticipant(participant: ParticipantInfo): void {
    this.roomParticipants = this.roomParticipants
      .filter((current) => current.connectionId !== participant.connectionId)
      .concat(participant);
    this.syncLocalEditLock(participant);
    this.publishRoomParticipants();
  }

  private removeRoomParticipants(
    shouldRemove: (participant: ParticipantInfo) => boolean
  ): void {
    this.roomParticipants = this.roomParticipants.filter(
      (participant) => !shouldRemove(participant)
    );
    this.syncLocalEditLock();
    this.publishRoomParticipants();
  }

  private syncLocalEditLock(participant?: ParticipantInfo): void {
    const localParticipant =
      participant?.connectionId === this.connection.connectionId
        ? participant
        : this.roomParticipants.find(
          (current) => current.connectionId === this.connection.connectionId
        );
    this.localEditLocked = Boolean(localParticipant?.isLocked);
  }

  private publishRoomParticipants(): void {
    const participants = [...this.roomParticipants];
    this.roomParticipantsListeners.forEach((listener) =>
      listener(participants)
    );
  }

  private async joinCurrentRoom(): Promise<boolean> {
    const result = await this.connection.invoke<{ status: string }>(
      'JoinRoom',
      this.roomId,
      this.accessKey,
      this.displayName,
      this.color,
      this.creatorToken,
      this.avatarUrl
    );
    this.roomJoined = this.roomJoined || result?.status === 'joined';
    return this.roomJoined;
  }

  private async sendOp(fileId: string, op: CrdtOp): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.invoke('SendFileOp', this.roomId, fileId, op);
    } catch (err) {
      console.error(
        '[SignalRCrdtProvider] Failed to send op:',
        errorMessage(err)
      );
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private emitChange(): void {
    this.changeListeners.forEach((l) => l());
  }
}
