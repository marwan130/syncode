import {
  getOrCreateJoinRequestId,
  isJoinRequestRejected,
  markJoinRequestRejected,
} from '../utils/userStorage';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { CrdtDocument } from '../crdt/CrdtDocument';
import type { CrdtId } from '../crdt/CrdtId';
import type { CrdtChar } from '../crdt/CrdtChar';
import type { InsertOp, DeleteOp, CrdtOp } from '../crdt/CrdtDocument';
import { PendingBuffer } from '../crdt/PendingBuffer';
import { parseProjectTreeOperation, ProjectTree } from '../crdt/ProjectTree';
import type { ProjectTreeOperation } from '../crdt/ProjectTree';
import {
  getProjectEntryPath,
  isSharedProjectPath,
} from '../crdt/projectPathRules';
import {
  clearPendingProjectTreeOperations,
  listPendingProjectTreeOperations,
  migratePendingProjectTreeOperations,
  removePendingProjectTreeOperation,
  savePendingProjectTreeOperation,
  validatePendingProjectTreeOperations,
} from '../crdt/pendingProjectTreeOutbox';
import type {
  ImportSnapshot,
  ImportedFileContent,
} from '../import/folderImport';
import { prepareProjectImport } from '../import/folderImport';
import {
  compressCrdtSnapshot,
  decompressCrdtSnapshot,
} from '../crdt/snapshotCompression';
import type { GithubRepositoryBaseline } from '../github/githubTypes';
import type {
  AwarenessState,
  ChatMessage,
  ConnectionStatus,
  ExecutionLanguage,
  ParticipantInfo,
  RoomEntry,
  RoomJoinRequest,
  TerminalOutput,
  TerminalSessionStart,
  TerminalWorkspaceEntry,
} from './signalRTypes';
export type {
  AwarenessState,
  ChatMessage,
  ConnectionStatus,
  ExecutionLanguage,
  ParticipantInfo,
  RoomEntry,
  RoomJoinRequest,
  TerminalOutput,
  TerminalSessionStart,
  TerminalWorkspaceEntry,
} from './signalRTypes';
import {
  normalizeChatMessage,
  normalizeParticipant,
} from './serverMessageNormalization';

function createAbortError(): DOMException {
  return new DOMException('The import was cancelled.', 'AbortError');
}

function commonPrefixLength(current: CrdtChar[], next: string[]): number {
  let length = 0;
  while (
    length < current.length &&
    length < next.length &&
    current[length].value === next[length]
  )
    length++;
  return length;
}

function commonSuffixLength(
  current: CrdtChar[],
  next: string[],
  prefixLength: number
): number {
  let length = 0;
  while (
    length < current.length - prefixLength &&
    length < next.length - prefixLength &&
    current[current.length - length - 1].value ===
      next[next.length - length - 1]
  )
    length++;
  return length;
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
  private projectRootName = '';
  private projectRootNameListeners = new Set<(name: string) => void>();
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
        .catch(() => {});
    }
    this.sendAwareness({
      cursor: null,
      name: this.displayName,
      color,
    }).catch(() => {});
  }

  public setLocalAvatarUrl(avatarUrl?: string): void {
    if (this.avatarUrl === avatarUrl) return;
    this.avatarUrl = avatarUrl;
    if (this.connection.state === HubConnectionState.Connected)
      this.connection
        .invoke('UpdateParticipantAvatar', avatarUrl ?? null)
        .catch(() => {});
  }
  public getFileContent(fileId: string): string {
    return this.documentFor(fileId).toVisibleString();
  }
  public getDocument(fileId: string): CrdtDocument {
    return this.documentFor(fileId);
  }
  public readonly siteId: string;
  private connection: HubConnection;
  private serverUrl: string;
  private roomId: string;
  private accessKey: string;
  private creatorToken: string | null;
  private readonly joinRequestId: string;
  private displayName: string;
  private color: string;
  private avatarUrl?: string;
  private statusListeners: Set<(s: ConnectionStatus) => void> = new Set();
  private snapshotSaveListeners = new Set<(isSaving: boolean) => void>();
  private activeSnapshotSaves = 0;
  private changeListeners: Set<() => void> = new Set();
  private fileContentListeners = new Set<(fileId: string) => void>();
  private awarenessListeners: Set<
    (peerId: string, state: AwarenessState) => void
  > = new Set();
  private snapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private terminalSessionIds = new Set<string>();
  private snapshotLoadQueue = Promise.resolve();
  private roomParticipantsListeners: Set<
    (participants: ParticipantInfo[]) => void
  > = new Set();
  private chatMessageListeners = new Set<(message: ChatMessage) => void>();
  private chatHistoryListeners = new Set<(messages: ChatMessage[]) => void>();
  private roomKickedListeners = new Set<() => void>();
  private roomExpiredListeners = new Set<() => void>();
  private roomJoinRequests: RoomJoinRequest[] = [];
  private roomJoinRequestsListeners = new Set<
    (requests: RoomJoinRequest[]) => void
  >();
  private joinRejected = false;
  private roomJoined = false;
  private roomRecoveryPending = false;
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
    creatorToken: string | null = null,
    joinRequestId = getOrCreateJoinRequestId(roomId)
  ) {
    this.siteId = siteId;
    this.roomId = roomId;
    this.serverUrl = serverUrl;
    this.accessKey = accessKey;
    this.creatorToken = creatorToken;
    this.joinRequestId = joinRequestId;
    this.displayName = displayName;
    this.color = color;
    this.projectTree = ProjectTree.fromEntries(siteId, this.files);
    this.pendingTreeReady = this.loadPendingTreeOperations();

    this.connection = new HubConnectionBuilder()
      .withUrl(`${serverUrl}/collabhub`)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: ({ previousRetryCount }) =>
          Math.min(30_000, 1_000 * 2 ** Math.min(previousRetryCount, 5)),
      })
      .configureLogging(import.meta.env.DEV ? LogLevel.Warning : LogLevel.None)
      .build();

    this.registerHubHandlers();
  }

  public get connectionId(): string | null {
    return this.connection.connectionId;
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public async connect(): Promise<void> {
    if (isJoinRequestRejected(this.roomId)) {
      this.joinRejected = true;
      this.emitStatus('join-rejected');
      return;
    }
    this.joinRejected = false;
    this.emitStatus('connecting');
    try {
      await this.connection.start();
      await this.pendingTreeReady;
      const joined = await this.joinCurrentRoom();
      if (joined && this.roomRecoveryPending)
        await this.restoreRecoveredWorkspaceSafely();
      if (!this.joinRejected)
        this.emitStatus(
          this.roomJoined || joined ? 'connected' : 'awaiting-approval'
        );
    } catch (err) {
      if (this.connection.state !== HubConnectionState.Disconnected) {
        await this.connection.stop().catch(() => {});
      }
      this.emitStatus('disconnected');
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    await this.flushPendingSnapshots();
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
    this.emitStatus('disconnected');
  }

  public async leaveRoom(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Reconnect before leaving the room.');
    await this.flushPendingSnapshots().catch(() => {});
    await this.connection.invoke('LeaveRoom', this.roomId);
    await this.connection.stop().catch(() => {});
    this.emitStatus('disconnected');
  }

  /**
   * Cancels a pending join request while still in the awaiting-approval state.
   * Safe to call when not yet fully joined.
   */
  public async cancelJoinRequest(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Reconnect before cancelling the join request.');
    await this.connection.invoke(
      'CancelJoinRequest',
      this.roomId,
      this.joinRequestId
    );
    await this.connection.stop().catch(() => {});
    this.emitStatus('disconnected');
  }

  private async flushPendingSnapshots(): Promise<void> {
    const pendingFiles = [...this.snapshotSaveTimers.keys()];
    this.snapshotSaveTimers.forEach((timer) => clearTimeout(timer));
    this.snapshotSaveTimers.clear();
    if (this.connection.state === HubConnectionState.Connected) {
      await Promise.all(
        pendingFiles.map((fileId) =>
          this.saveFileSnapshot(fileId).catch(() => {})
        )
      );
    }
  }

  public localInsert(
    originId: CrdtId | null,
    value: string,
    fileId = this.activeFile
  ): InsertOp {
    const op = this.documentFor(fileId).localInsert(originId, value);
    this.emitChange();
    this.emitFileContentChange(fileId);
    this.sendOp(fileId, op).catch(() => {});
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

  public onProjectRootNameChange(listener: (name: string) => void): () => void {
    this.projectRootNameListeners.add(listener);
    listener(this.projectRootName);
    return () => this.projectRootNameListeners.delete(listener);
  }

  public onActiveFileChange(listener: (file: RoomEntry) => void): () => void {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
  }

  public async createEntry(
    name: string,
    parentId: string | null,
    isFolder: boolean,
    activate = true
  ): Promise<string> {
    const id = crypto.randomUUID().replaceAll('-', '');
    const operation = this.projectTree.createEntry({
      id,
      name,
      parentId,
      isFolder,
    });
    await this.submitTreeOperation(operation);
    if (!isFolder && activate) this.setActiveFile(id);
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
    repositoryBaseline: GithubRepositoryBaseline | null = null,
    projectRootName?: string,
    replaceWorkspace = false,
    onImportProgress?: (completedFiles: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) throw createAbortError();
    this.validateProjectImportAccess();
    await this.flushTreeOperations();
    if (signal?.aborted) throw createAbortError();
    const importedFiles = await prepareProjectImport(files, this.siteId);
    if (signal?.aborted) throw createAbortError();
    const existingEntriesByPath = new Map(
      (replaceWorkspace ? [] : [...this.getEntriesByPath()]).map(
        ([path, entry]) => [path.toLowerCase(), entry]
      )
    );
    for (const file of importedFiles) {
      const existing = existingEntriesByPath.get(file.path.toLowerCase());
      if (existing && !existing.isFolder) file.id = existing.id;
    }

    const importId = crypto.randomUUID().replaceAll('-', '');
    const handleImportProgress = (
      receivedImportId: string,
      completedFiles: number
    ) => {
      if (receivedImportId === importId) onImportProgress?.(completedFiles);
    };
    this.connection.on('ProjectImportProgress', handleImportProgress);
    const requestCancellation = () => {
      void this.connection
        .invoke('CancelProjectImport', this.roomId, importId)
        .catch(() => undefined);
    };
    signal?.addEventListener('abort', requestCancellation, { once: true });
    let operations: ProjectTreeOperation[];
    try {
      operations = await this.connection.invoke<ProjectTreeOperation[]>(
        'ImportProject',
        this.roomId,
        importId,
        importedFiles.map(({ path, id, compressedSnapshot }) => ({
          path,
          id,
          compressedSnapshot,
        })),
        repositoryBaseline,
        projectRootName,
        replaceWorkspace
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', requestCancellation);
      this.connection.off('ProjectImportProgress', handleImportProgress);
    }

    for (const operation of operations) this.applyTreeOperation(operation);
    for (const file of importedFiles) {
      const document = this.documentFor(file.id);
      document.fromSnapshot(
        await decompressCrdtSnapshot(file.compressedSnapshot)
      );
      this.buffers.get(file.id)?.processPending();
      this.emitFileContentChange(file.id);
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
    if (!participant) throw new Error('Only room admins can import a folder.');
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

  public async revokeRoomMembership(
    roomId: string,
    accessKey: string,
    requestId: string
  ): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    await this.connection.invoke(
      'LeaveRoomByTicket',
      roomId,
      accessKey,
      requestId
    );
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
        'A project change could not be saved. Check your connection and try again.'
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
      () => {}
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
    const storedOperations = await listPendingProjectTreeOperations(
      this.roomId
    );
    this.pendingTreeOperations =
      validatePendingProjectTreeOperations(storedOperations);
    for (const operation of this.pendingTreeOperations)
      this.projectTree.applyOperation(operation);
    this.updateFiles(this.projectTree.getEntries());
  }

  public localDelete(id: CrdtId, fileId = this.activeFile): DeleteOp {
    const op = this.documentFor(fileId).localDelete(id);
    this.emitChange();
    this.emitFileContentChange(fileId);
    this.sendOp(fileId, op).catch(() => {});
    this.scheduleSnapshotSave(fileId);
    return op;
  }

  private scheduleSnapshotSave(fileId: string): void {
    const existingTimer = this.snapshotSaveTimers.get(fileId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.snapshotSaveTimers.delete(fileId);
      this.saveFileSnapshot(fileId).catch(() => {});
    }, 1000);
    this.snapshotSaveTimers.set(fileId, timer);
  }

  private async saveFileSnapshot(fileId: string): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    this.activeSnapshotSaves++;
    if (this.activeSnapshotSaves === 1)
      this.snapshotSaveListeners.forEach((listener) => listener(true));
    try {
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
    } finally {
      this.activeSnapshotSaves--;
      if (this.activeSnapshotSaves === 0)
        this.snapshotSaveListeners.forEach((listener) => listener(false));
    }
  }

  public async sendAwareness(state: AwarenessState): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.invoke('UpdateAwareness', this.roomId, state);
    } catch {
      console.error('Live collaboration updates are temporarily unavailable.');
    }
  }

  public async sendChatMessage(content: string): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    await this.connection.invoke('SendChatMessage', this.roomId, content);
  }

  public async runTerminalFile(
    sessionId: string,
    language: ExecutionLanguage,
    sourcePath: string
  ): Promise<void> {
    await this.flushTerminalWorkspaces();
    await this.flushRoomWorkspace();
    await this.connection.invoke(
      'RunTerminalFile',
      sessionId,
      language,
      sourcePath
    );
  }

  public async startTerminal(): Promise<TerminalSessionStart> {
    await this.flushRoomWorkspace();
    const session =
      await this.connection.invoke<TerminalSessionStart>('StartTerminal');
    this.terminalSessionIds.add(session.sessionId);
    return session;
  }

  public async createLanguageServerSocket(language: string): Promise<string> {
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Join the room before opening language tools.');
    await this.flushRoomWorkspace();
    const session = await this.connection.invoke<{ ticket: string }>(
      'StartLanguageServer',
      language
    );
    const socketUrl = new URL('/api/language-servers', this.serverUrl);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    socketUrl.searchParams.set('ticket', session.ticket);
    return socketUrl.toString();
  }

  public async syncTerminalWorkspace(
    changedEntries: TerminalWorkspaceEntry[],
    deletedEntries: TerminalWorkspaceEntry[]
  ): Promise<number> {
    if (this.localEditLocked)
      throw new Error('The room admin has locked your editing access.');
    const changedConflicts =
      await this.syncChangedTerminalEntries(changedEntries);
    const deletedConflicts =
      await this.syncDeletedTerminalEntries(deletedEntries);
    return changedConflicts + deletedConflicts;
  }

  private async syncChangedTerminalEntries(
    entries: TerminalWorkspaceEntry[]
  ): Promise<number> {
    let conflicts = 0;
    const ordered = [...entries].sort(
      (left, right) =>
        left.path.split('/').length - right.path.split('/').length ||
        left.path.localeCompare(right.path)
    );
    for (const entry of ordered)
      if (await this.syncTerminalEntry(entry)) conflicts++;
    return conflicts;
  }

  private async syncDeletedTerminalEntries(
    entries: TerminalWorkspaceEntry[]
  ): Promise<number> {
    let conflicts = 0;
    const deleted = entries
      .filter((entry) => isSharedProjectPath(entry.path))
      .sort(
        (left, right) =>
          right.path.split('/').length - left.path.split('/').length
      );
    const removedRoots = new Set<string>();
    for (const item of deleted)
      if (await this.deleteTerminalEntry(item, deleted, removedRoots))
        conflicts++;
    return conflicts;
  }

  private async syncTerminalEntry(
    entry: TerminalWorkspaceEntry
  ): Promise<boolean> {
    if (!isSharedProjectPath(entry.path)) return false;
    const current = this.getEntriesByPath().get(entry.path);
    const updated = current ? this.updateTerminalEntry(entry, current) : null;
    if (updated !== null) return !updated;
    return !(await this.createTerminalEntry(entry));
  }

  private updateTerminalEntry(
    entry: TerminalWorkspaceEntry,
    current: RoomEntry
  ): boolean {
    if (current.isFolder !== entry.isFolder) return false;
    if (entry.isFolder) return true;
    return this.updateTerminalFileEntry(entry, current);
  }

  private updateTerminalFileEntry(
    entry: TerminalWorkspaceEntry,
    current: RoomEntry
  ): boolean {
    const currentContent = this.getFileContent(current.id);
    if (currentContent === entry.content) return true;
    if (entry.previousContent !== currentContent) return false;
    this.replaceFileContent(current.id, entry.content);
    return true;
  }

  private async createTerminalEntry(
    entry: TerminalWorkspaceEntry
  ): Promise<boolean> {
    if (entry.previousContent !== null && entry.previousContent !== undefined)
      return false;
    return this.createTerminalPath(entry);
  }

  private async createTerminalPath(
    entry: TerminalWorkspaceEntry
  ): Promise<boolean> {
    let parentId: string | null = null;
    const segments = entry.path.split('/');
    for (let index = 0; index < segments.length; index++) {
      const isFolder = index < segments.length - 1 || entry.isFolder;
      parentId = await this.createTerminalPathSegment(
        segments.slice(0, index + 1).join('/'),
        segments[index],
        parentId,
        isFolder,
        entry
      );
      if (!parentId) return false;
    }
    return true;
  }

  private async createTerminalPathSegment(
    path: string,
    name: string,
    parentId: string | null,
    isFolder: boolean,
    entry: TerminalWorkspaceEntry
  ): Promise<string | null> {
    const existing = this.getEntriesByPath().get(path);
    if (existing) return existing.isFolder === isFolder ? existing.id : null;
    const id = await this.createEntry(name, parentId, isFolder, false);
    if (!isFolder && entry.content) this.replaceFileContent(id, entry.content);
    return id;
  }

  private async deleteTerminalEntry(
    item: TerminalWorkspaceEntry,
    deleted: TerminalWorkspaceEntry[],
    removedRoots: Set<string>
  ): Promise<boolean> {
    const path = item.path;
    if ([...removedRoots].some((root) => path.startsWith(`${root}/`)))
      return false;
    const entries = this.getEntriesByPath();
    const entry = entries.get(path);
    if (!entry) return false;
    if (this.hasTerminalDeletionConflict(item, entry, deleted, entries))
      return true;
    await this.deleteEntry(entry.id);
    removedRoots.add(path);
    return false;
  }

  private hasTerminalDeletionConflict(
    item: TerminalWorkspaceEntry,
    entry: RoomEntry,
    deleted: TerminalWorkspaceEntry[],
    entries: Map<string, RoomEntry>
  ): boolean {
    if (!entry.isFolder) return this.getFileContent(entry.id) !== item.content;
    return deleted.some(
      (child) =>
        child.path.startsWith(`${item.path}/`) && entries.has(child.path)
    );
  }

  private async flushRoomWorkspace(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected)
      throw new Error('Connect to the room before using its workspace.');
    await this.pendingTreeReady;
    await this.flushTreeOperations();
    const pendingIds = [...this.snapshotSaveTimers.keys()];
    for (const fileId of pendingIds) {
      const timer = this.snapshotSaveTimers.get(fileId);
      if (timer) clearTimeout(timer);
      this.snapshotSaveTimers.delete(fileId);
      await this.saveFileSnapshot(fileId);
    }
  }

  private async flushTerminalWorkspaces(): Promise<void> {
    for (const sessionId of this.terminalSessionIds)
      await this.syncTerminalSessionWorkspace(sessionId);
  }

  private async syncTerminalSessionWorkspace(sessionId: string): Promise<void> {
    const output = await this.readTerminalOutput(sessionId, 2_147_483_647);
    await this.syncTerminalWorkspace(
      output.changedEntries,
      output.deletedEntries
    );
  }

  private getEntriesByPath(): Map<string, RoomEntry> {
    const paths = new Map<string, RoomEntry>();
    for (const entry of this.files) {
      const path = getProjectEntryPath(entry, this.files);
      if (path) paths.set(path, entry);
    }
    return paths;
  }

  private replaceFileContent(fileId: string, content: string): void {
    const document = this.documentFor(fileId);
    const current = document.chars.filter((character) => !character.isDeleted);
    const next = [...content];
    const prefix = commonPrefixLength(current, next);
    const suffix = commonSuffixLength(current, next, prefix);
    this.deleteReplacedCharacters(
      fileId,
      current.slice(prefix, current.length - suffix)
    );
    this.insertReplacementCharacters(
      fileId,
      next.slice(prefix, next.length - suffix),
      current[prefix - 1]?.id ?? null
    );
  }

  public replaceFileText(fileId: string, content: string): void {
    if (this.localEditLocked)
      throw new Error('The room admin has locked your editing access.');
    if (!this.files.some((entry) => entry.id === fileId && !entry.isFolder))
      throw new Error('The selected file is no longer available.');
    this.replaceFileContent(fileId, content);
  }

  private deleteReplacedCharacters(
    fileId: string,
    characters: CrdtChar[]
  ): void {
    for (const character of characters) this.localDelete(character.id, fileId);
  }

  private insertReplacementCharacters(
    fileId: string,
    characters: string[],
    initialOriginId: CrdtId | null
  ): void {
    let originId = initialOriginId;
    for (const character of characters)
      originId = this.localInsert(originId, character, fileId).char.id;
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
    try {
      await this.syncTerminalSessionWorkspace(sessionId);
    } finally {
      this.terminalSessionIds.delete(sessionId);
      await this.connection.invoke('CloseTerminal', sessionId);
    }
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

  public onSnapshotSaveChange(
    listener: (isSaving: boolean) => void
  ): () => void {
    this.snapshotSaveListeners.add(listener);
    listener(this.activeSnapshotSaves > 0);
    return () => this.snapshotSaveListeners.delete(listener);
  }

  public onDocumentChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  public onFileContentChange(listener: (fileId: string) => void): () => void {
    this.fileContentListeners.add(listener);
    return () => this.fileContentListeners.delete(listener);
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

  public onRoomExpired(listener: () => void): () => void {
    this.roomExpiredListeners.add(listener);
    return () => this.roomExpiredListeners.delete(listener);
  }

  public onRoomJoinRequestsChanged(
    listener: (requests: RoomJoinRequest[]) => void
  ): () => void {
    this.roomJoinRequestsListeners.add(listener);
    listener([...this.roomJoinRequests]);
    return () => this.roomJoinRequestsListeners.delete(listener);
  }

  public approveRoomJoinRequest(requestId: string): Promise<void> {
    return this.connection.invoke(
      'ApproveRoomJoinRequest',
      this.roomId,
      requestId
    );
  }

  public rejectRoomJoinRequest(requestId: string): Promise<void> {
    return this.connection.invoke(
      'RejectRoomJoinRequest',
      this.roomId,
      requestId
    );
  }

  public getRoomJoinRequests(): Promise<RoomJoinRequest[]> {
    return this.connection.invoke('GetRoomJoinRequests', this.roomId);
  }

  public onGithubRepositoryChange(
    listener: (baseline: GithubRepositoryBaseline | null) => void
  ): () => void {
    this.githubRepositoryListeners.add(listener);
    listener(this.githubRepositoryBaseline);
    return () => this.githubRepositoryListeners.delete(listener);
  }

  private registerHubHandlers(): void {
    this.registerRoomHandlers();
    this.registerChatHandlers();
    this.registerRepositoryHandlers();
    this.registerProjectHandlers();
    this.registerParticipantHandlers();
    this.registerConnectionLifecycleHandlers();
  }

  private registerRoomHandlers(): void {
    this.connection.on('RoomExpired', () => {
      void this.clearExpiredRoomState();
    });
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
      markJoinRequestRejected(this.roomId);
      this.emitStatus('join-rejected');
      void this.connection.stop();
    });
  }

  private async clearExpiredRoomState(): Promise<void> {
    await clearPendingProjectTreeOperations(this.roomId).catch(() => {});
    this.roomJoined = false;
    this.pendingTreeOperations = [];
    this.documents.clear();
    this.buffers.clear();
    this.files = [];
    this.activeFile = '';
    this.projectTree = ProjectTree.fromEntries(this.siteId, []);
    this.roomParticipants = [];
    this.githubRepositoryBaseline = null;
    this.projectRootName = '';
    this.updateFiles([]);
    this.roomParticipantsListeners.forEach((listener) => listener([]));
    this.githubRepositoryListeners.forEach((listener) => listener(null));
    this.emitStatus('disconnected');
    this.roomExpiredListeners.forEach((listener) => listener());
    await this.connection.stop().catch(() => {});
  }

  private registerChatHandlers(): void {
    this.connection.on('ChatMessage', (raw: Record<string, unknown>) => {
      this.chatMessageListeners.forEach((listener) =>
        listener(normalizeChatMessage(raw))
      );
    });
    this.connection.on(
      'ChatHistory',
      (rawMessages: Array<Record<string, unknown>>) => {
        const messages = (rawMessages || []).map((message) =>
          normalizeChatMessage(message)
        );
        this.chatHistoryListeners.forEach((listener) => listener(messages));
      }
    );
  }

  private registerRepositoryHandlers(): void {
    this.connection.on(
      'GithubRepositoryBaseline',
      (baseline: GithubRepositoryBaseline | null) => {
        this.githubRepositoryBaseline = baseline;
        this.githubRepositoryListeners.forEach((listener) =>
          listener(baseline)
        );
      }
    );
  }

  private registerProjectHandlers(): void {
    this.connection.on('ProjectRootNameChanged', (name: string | null) => {
      this.projectRootName = name ?? '';
      this.projectRootNameListeners.forEach((listener) =>
        listener(this.projectRootName)
      );
    });
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
    this.connection.on('ProjectTreeHistory', (operations: string[]) => {
      for (const operationJson of operations ?? [])
        this.applyTreeOperation(parseProjectTreeOperation(operationJson));
      void this.flushTreeOperations().catch(() => {});
    });
    this.connection.on('ProjectTreeSnapshot', (snapshot: string) => {
      try {
        this.projectTree.fromSnapshot(snapshot);
        this.updateFiles(this.projectTree.getEntries());
      } catch {
        console.error('The shared project structure could not be loaded.');
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
            this.emitFileContentChange(fileId);
          })
          .catch(() => {
            console.error('A shared file could not be loaded.');
          });
      }
    );

    this.connection.on('ReceiveFileOp', (fileId: string, op: CrdtOp) => {
      this.buffers.get(fileId)?.process(op);
      this.emitChange();
      this.emitFileContentChange(fileId);
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
          .catch(() => {
            console.error('A shared file update could not be sent.');
          });
      }
    );
  }

  private registerParticipantHandlers(): void {
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
      const participant = normalizeParticipant(raw);
      this.upsertRoomParticipant(participant);
      if (
        this.roomRecoveryPending &&
        participant.connectionId === this.connection.connectionId &&
        !participant.isLocked
      ) {
        void this.restoreRecoveredWorkspaceSafely();
      }
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
        avatarUrl?: string,
        memberId?: string
      ) => {
        this.upsertRoomParticipant({
          connectionId: peerId,
          memberId,
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
  }

  private registerConnectionLifecycleHandlers(): void {
    this.connection.onreconnecting(() => {
      this.roomJoined = false;
      this.emitStatus('reconnecting');
    });

    this.connection.onreconnected(async () => {
      try {
        const joined = await this.joinCurrentRoom();
        const recoveringWorkspace = joined && this.roomRecoveryPending;
        if (recoveringWorkspace) {
          await this.restoreRecoveredWorkspaceSafely();
        } else if (joined) {
          await this.flushTreeOperations();
          await this.syncOfflineSnapshotsSafely();
        }
        if (!this.joinRejected)
          this.emitStatus(
            this.roomJoined || joined ? 'connected' : 'awaiting-approval'
          );
      } catch {
        this.emitStatus('disconnected');
        console.error(
          'Could not reconnect to this room. Refresh and try again.'
        );
        await this.connection.stop().catch(() => {});
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
    const result = await this.connection.invoke<{
      status: string;
      recovered?: boolean;
    }>(
      'JoinRoom',
      this.roomId,
      this.accessKey,
      this.displayName,
      this.color,
      this.creatorToken,
      this.avatarUrl,
      this.joinRequestId
    );
    this.roomRecoveryPending ||= Boolean(result?.recovered);
    if (result?.status === 'rejected') {
      this.joinRejected = true;
      markJoinRequestRejected(this.roomId);
      this.emitStatus('join-rejected');
      await this.connection.stop();
      return false;
    }
    this.roomJoined = this.roomJoined || result?.status === 'joined';
    return this.roomJoined;
  }

  private async restoreRecoveredWorkspaceSafely(): Promise<void> {
    try {
      await this.restoreRecoveredWorkspace();
    } catch {
      console.error(
        'Workspace recovery could not finish. It will retry when you reconnect.'
      );
    }
  }

  private async syncOfflineSnapshotsSafely(): Promise<void> {
    try {
      await this.snapshotLoadQueue;
      const snapshots: Array<{ fileId: string; snapshot: string }> = [];
      for (const entry of this.files) {
        if (entry.isFolder) continue;
        const snapshot = await compressCrdtSnapshot(
          this.documentFor(entry.id).toSnapshot()
        );
        snapshots.push({ fileId: entry.id, snapshot: snapshot.value });
      }
      if (snapshots.length > 0)
        await this.connection.invoke(
          'SyncOfflineSnapshots',
          this.roomId,
          snapshots
        );
    } catch {
      console.error(
        'Offline changes could not be synced yet. Check your connection and try again.'
      );
    }
  }

  private async restoreRecoveredWorkspace(): Promise<void> {
    await this.pendingTreeReady;
    const files: ImportSnapshot[] = [];
    for (const entry of this.files) {
      if (entry.isFolder) continue;
      const path = getProjectEntryPath(entry, this.files);
      if (!path) continue;
      const snapshot = await compressCrdtSnapshot(
        this.documentFor(entry.id).toSnapshot()
      );
      files.push({ path, id: entry.id, compressedSnapshot: snapshot.value });
    }

    await clearPendingProjectTreeOperations(this.roomId);
    this.pendingTreeOperations = [];
    const operations = await this.connection.invoke<ProjectTreeOperation[]>(
      'RestoreExpiredWorkspace',
      files,
      this.projectRootName || null
    );
    for (const operation of operations ?? [])
      this.applyTreeOperation(operation);
    await this.snapshotLoadQueue;
    this.roomRecoveryPending = false;
  }

  private async sendOp(fileId: string, op: CrdtOp): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.invoke('SendFileOp', this.roomId, fileId, op);
    } catch {
      console.error(
        'A file change could not be sent. Check your connection and try again.'
      );
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private emitChange(): void {
    this.changeListeners.forEach((l) => l());
  }

  private emitFileContentChange(fileId: string): void {
    this.fileContentListeners.forEach((listener) => listener(fileId));
  }
}
