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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface AwarenessState {
  cursor: CursorAnchor | null;
  name: string;
  color: string;
  userId?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ParticipantInfo {
  connectionId: string;
  displayName: string;
  color: string;
  userId?: string;
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

interface ExecutionSubmission {
  jobId: string;
  queuePosition: number;
}

interface TerminalSessionStart {
  sessionId: string;
}

interface TerminalOutput {
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
  private projectTree = new ProjectTree('pending');
  private pendingTreeOperations: ProjectTreeOperation[] = [];
  private treeFlushPromise: Promise<void> | null = null;
  private roomParticipants: ParticipantInfo[] = [];
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
  public getFileContent(fileId: string): string {
    return this.documentFor(fileId).toVisibleString();
  }
  public getDocument(fileId: string): CrdtDocument {
    return this.documentFor(fileId);
  }
  public readonly siteId: string;
  private userId: string;
  private connection: HubConnection;
  private roomId: string;
  private accessKey: string;
  private displayName: string;
  private color: string;
  private statusListeners: Set<(s: ConnectionStatus) => void> = new Set();
  private changeListeners: Set<() => void> = new Set();
  private awarenessListeners: Set<
    (peerId: string, state: AwarenessState) => void
  > = new Set();
  private evictedListeners: Set<(newRoomId?: string) => void> = new Set();
  private snapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private roomParticipantsListeners: Set<
    (participants: ParticipantInfo[]) => void
  > = new Set();
  private chatMessageListeners = new Set<(message: ChatMessage) => void>();
  private chatHistoryListeners = new Set<(messages: ChatMessage[]) => void>();
  private executionEventListeners = new Set<(event: ExecutionEvent) => void>();

  constructor(
    siteId: string,
    userId: string,
    roomId: string,
    accessKey: string,
    serverUrl: string,
    displayName: string = `User ${siteId.slice(0, 6)}`,
    color: string = '#38bdf8'
  ) {
    this.siteId = siteId;
    this.projectTree = new ProjectTree(siteId);
    this.userId = userId;
    this.roomId = roomId;
    this.accessKey = accessKey;
    this.displayName = displayName;
    this.color = color;
    this.projectTree = ProjectTree.fromEntries(siteId, this.files);
    this.pendingTreeOperations = this.readPendingTreeOperations();
    for (const operation of this.pendingTreeOperations) {
      try {
        this.projectTree.applyOperation(operation);
      } catch {
        /* Invalid local cache is discarded below. */
      }
    }
    this.files = this.projectTree.getEntries();

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
      await this.connection.start();
      await this.joinCurrentRoom();
      this.emitStatus('connected');
    } catch (err) {
      if (this.connection.state !== HubConnectionState.Disconnected) {
        await this.connection.stop().catch(() => {});
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
        pendingFiles.map((fileId) =>
          this.connection
            .invoke(
              'SaveFileSnapshot',
              this.roomId,
              fileId,
              this.documentFor(fileId).toSnapshot()
            )
            .catch(() => {})
        )
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

  private updateFiles(files: RoomEntry[]): void {
    const nextIds = new Set(files.map((entry) => entry.id));
    for (const oldEntry of this.files) {
      if (nextIds.has(oldEntry.id)) continue;
      this.documents.delete(oldEntry.id);
      this.buffers.delete(oldEntry.id);
      const timer = this.snapshotSaveTimers.get(oldEntry.id);
      if (timer) clearTimeout(timer);
      this.snapshotSaveTimers.delete(oldEntry.id);
    }
    this.files = files;
    for (const file of files) {
      if (!file.isFolder) this.documentFor(file.id);
    }
    if (!files.some((file) => file.id === this.activeFile && !file.isFolder))
      this.activeFile = files.find((file) => !file.isFolder)?.id ?? '';
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
    this.applyTreeOperation(operation);
    if (
      !this.pendingTreeOperations.some(
        (pending) =>
          pending.opId.siteId === operation.opId.siteId &&
          pending.opId.counter === operation.opId.counter
      )
    ) {
      this.pendingTreeOperations.push(operation);
      this.savePendingTreeOperations();
    }
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
      const operation = this.pendingTreeOperations[0];
      try {
        await this.connection.invoke(
          'ApplyProjectTreeOperation',
          this.roomId,
          operation
        );
        this.pendingTreeOperations = this.pendingTreeOperations.filter(
          (pending) =>
            pending.opId.siteId !== operation.opId.siteId ||
            pending.opId.counter !== operation.opId.counter
        );
        this.savePendingTreeOperations();
      } catch (error) {
        this.projectTree.removeOperation(operation.opId);
        this.pendingTreeOperations = this.pendingTreeOperations.filter(
          (pending) =>
            pending.opId.siteId !== operation.opId.siteId ||
            pending.opId.counter !== operation.opId.counter
        );
        this.updateFiles(this.projectTree.getEntries());
        this.savePendingTreeOperations();
        console.error(
          '[SignalRCrdtProvider] Failed to sync project tree operation:',
          errorMessage(error)
        );
        throw error;
      }
    }
  }

  private pendingTreeStorageKey(): string {
    return `syncode:project-tree-pending:${this.roomId}`;
  }

  private readPendingTreeOperations(): ProjectTreeOperation[] {
    try {
      const value = localStorage.getItem(this.pendingTreeStorageKey());
      if (!value) return [];
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as ProjectTreeOperation[]) : [];
    } catch {
      try {
        localStorage.removeItem(this.pendingTreeStorageKey());
      } catch {
        /* Browser storage can be disabled. */
      }
      return [];
    }
  }

  private savePendingTreeOperations(): void {
    try {
      if (this.pendingTreeOperations.length === 0)
        localStorage.removeItem(this.pendingTreeStorageKey());
      else
        localStorage.setItem(
          this.pendingTreeStorageKey(),
          JSON.stringify(this.pendingTreeOperations)
        );
    } catch {
      // The in-memory queue remains active if browser storage is unavailable.
    }
  }

  public localDelete(id: CrdtId, fileId = this.activeFile): DeleteOp {
    const op = this.documentFor(fileId).localDelete(id);
    this.emitChange();
    this.sendOp(fileId, op).catch(() => {});
    this.scheduleSnapshotSave(fileId);
    return op;
  }

  private scheduleSnapshotSave(fileId: string): void {
    const existingTimer = this.snapshotSaveTimers.get(fileId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.snapshotSaveTimers.delete(fileId);
      if (this.connection.state === HubConnectionState.Connected) {
        this.connection
          .invoke(
            'SaveFileSnapshot',
            this.roomId,
            fileId,
            this.documentFor(fileId).toSnapshot()
          )
          .catch(() => {});
      }
    }, 1000);
    this.snapshotSaveTimers.set(fileId, timer);
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
    requestId: string
  ): Promise<ExecutionSubmission> {
    return this.connection.invoke<ExecutionSubmission>(
      'RunExecution',
      language,
      source,
      requestId
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

  public onEvicted(listener: (newRoomId?: string) => void): () => void {
    this.evictedListeners.add(listener);
    return () => this.evictedListeners.delete(listener);
  }

  public onRoomParticipants(
    listener: (participants: ParticipantInfo[]) => void
  ): () => void {
    this.roomParticipantsListeners.add(listener);
    listener([...this.roomParticipants]);
    return () => this.roomParticipantsListeners.delete(listener);
  }

  private registerHubHandlers(): void {
    const emitExecutionEvent = (event: ExecutionEvent) => {
      this.executionEventListeners.forEach((listener) => listener(event));
    };
    this.connection.on('ExecutionOutput', emitExecutionEvent);
    this.connection.on('ExecutionCompleted', emitExecutionEvent);
    this.connection.on('ExecutionFailed', emitExecutionEvent);

    this.connection.on('ChatMessage', (raw: Record<string, unknown>) => {
      this.chatMessageListeners.forEach((listener) =>
        listener(this.normalizeChatMessage(raw))
      );
    });

    this.connection.on(
      'ChatHistory',
      (rawMessages: Array<Record<string, unknown>>) => {
        const messages = (rawMessages || []).map((message) =>
          this.normalizeChatMessage(message)
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
        /* Initial local state may be empty. */
      }
      this.updateFiles(this.projectTree.getEntries());
    });
    this.connection.on(
      'ProjectTreeHistory',
      (operations: ProjectTreeOperation[]) => {
        for (const operation of operations ?? [])
          this.applyTreeOperation(operation);
        void this.flushTreeOperations().catch(() => {});
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
        try {
          this.documentFor(fileId).fromSnapshot(snapshotJson);
          this.buffers.get(fileId)?.processPending();
          this.emitChange();
          this.scheduleSnapshotSave(fileId);
        } catch (err) {
          console.error(
            '[SignalRCrdtProvider] Failed to load snapshot:',
            errorMessage(err)
          );
        }
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
        this.connection
          .invoke(
            'SendFileSnapshotToPeer',
            this.roomId,
            fileId,
            targetConnectionId,
            this.documentFor(fileId).toSnapshot()
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
          this.normalizeParticipant(p)
        );
        this.setRoomParticipants(participants);
      }
    );

    this.connection.on('ParticipantUpdated', (raw: Record<string, unknown>) => {
      this.upsertRoomParticipant(this.normalizeParticipant(raw));
    });

    this.connection.on(
      'PeerJoined',
      (
        peerId: string,
        displayName: string,
        color: string,
        userId?: string,
        isAdmin = false,
        isLocked = false
      ) => {
        this.upsertRoomParticipant({
          connectionId: peerId,
          displayName,
          color,
          userId,
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

    this.connection.on(
      'PeerLeftByUser',
      (userId: string, newRoomId?: string) => {
        this.removeRoomParticipants(
          (participant) => participant.userId === userId
        );
        if (userId === this.userId) {
          this.evictedListeners.forEach((l) => l(newRoomId));
          this.disconnect().catch(() => {});
        }
      }
    );

    this.connection.onreconnecting(() => {
      this.emitStatus('reconnecting');
    });

    this.connection.onreconnected(async () => {
      try {
        await this.joinCurrentRoom();
        await this.flushTreeOperations();
        this.emitStatus('connected');
      } catch (err) {
        this.emitStatus('disconnected');
        console.error(
          '[SignalRCrdtProvider] Failed to rejoin room after reconnect:',
          errorMessage(err)
        );
        await this.connection.stop().catch(() => {});
      }
    });

    this.connection.onclose(() => {
      this.emitStatus('disconnected');
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

  private normalizeParticipant(raw: Record<string, unknown>): ParticipantInfo {
    return {
      connectionId: String(raw.connectionId ?? raw.ConnectionId ?? ''),
      displayName: String(raw.displayName ?? raw.DisplayName ?? 'Anonymous'),
      color: String(raw.color ?? raw.Color ?? '#38bdf8'),
      userId: raw.userId
        ? String(raw.userId)
        : raw.UserId
          ? String(raw.UserId)
          : undefined,
      isAdmin: Boolean(raw.isAdmin ?? raw.IsAdmin),
      isLocked: Boolean(raw.isLocked ?? raw.IsLocked),
    };
  }

  private normalizeChatMessage(raw: Record<string, unknown>): ChatMessage {
    return {
      id: String(raw.id ?? raw.Id ?? ''),
      author: String(raw.author ?? raw.Author ?? 'Anonymous'),
      color: String(raw.color ?? raw.Color ?? '#38bdf8'),
      content: String(raw.content ?? raw.Content ?? ''),
      sentAt: String(raw.sentAt ?? raw.SentAt ?? new Date().toISOString()),
    };
  }

  private async joinCurrentRoom(): Promise<void> {
    await this.connection.invoke(
      'JoinRoom',
      this.roomId,
      this.accessKey,
      this.userId,
      this.displayName,
      this.color
    );
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
