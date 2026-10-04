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

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface AwarenessState {
  cursor: CursorAnchor | null;
  name: string;
  color: string;
  userId?: string;
}

export interface ParticipantInfo {
  connectionId: string;
  displayName: string;
  color: string;
  userId?: string;
}

export interface ChatMessage {
  id: string;
  author: string;
  color: string;
  content: string;
  sentAt: string;
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
  private activeFile = 'main.cpp';
  private files: RoomEntry[] = [
    { id: 'main.cpp', name: 'main.cpp', parentId: null, isFolder: false },
  ];
  private fileListeners = new Set<(files: RoomEntry[]) => void>();
  private activeFileListeners = new Set<(file: RoomEntry) => void>();
  public get doc(): CrdtDocument {
    return this.documentFor(this.activeFile);
  }
  public get fileList(): RoomEntry[] {
    return this.files;
  }
  public get activeFileId(): string {
    return this.activeFile;
  }
  public readonly siteId: string;
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
  private peerLeftListeners: Set<(peerId: string) => void> = new Set();
  private peerLeftByUserListeners: Set<
    (userId: string, newRoomId?: string) => void
  > = new Set();
  private evictedListeners: Set<(newRoomId?: string) => void> = new Set();
  private snapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private peerJoinedListeners: Set<
    (
      peerId: string,
      displayName: string,
      color: string,
      userId?: string
    ) => void
  > = new Set();
  private roomParticipantsListeners: Set<
    (participants: ParticipantInfo[]) => void
  > = new Set();
  private chatMessageListeners = new Set<(message: ChatMessage) => void>();
  private chatHistoryListeners = new Set<(messages: ChatMessage[]) => void>();

  constructor(
    siteId: string,
    roomId: string,
    accessKey: string,
    serverUrl: string,
    displayName: string = `User ${siteId.slice(0, 6)}`,
    color: string = '#38bdf8'
  ) {
    this.siteId = siteId;
    this.roomId = roomId;
    this.accessKey = accessKey;
    this.displayName = displayName;
    this.color = color;
    this.documentFor(this.activeFile);

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

  public localInsert(originId: CrdtId | null, value: string): InsertOp {
    const fileId = this.activeFile;
    const op = this.documentFor(fileId).localInsert(originId, value);
    this.emitChange();
    this.sendOp(fileId, op).catch(() => {});
    this.scheduleSnapshotSave(fileId);
    return op;
  }

  private documentFor(fileId: string): CrdtDocument {
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
    const id = await this.connection.invoke<string>(
      'CreateEntry',
      this.roomId,
      name,
      parentId,
      isFolder
    );
    if (!isFolder) this.setActiveFile(id);
    return id;
  }
  public async renameEntry(entryId: string, name: string): Promise<void> {
    await this.connection.invoke('RenameEntry', this.roomId, entryId, name);
  }
  public async deleteEntry(entryId: string): Promise<void> {
    await this.connection.invoke('DeleteEntry', this.roomId, entryId);
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
      this.activeFile = files.find((file) => !file.isFolder)?.id ?? 'main.cpp';
    this.fileListeners.forEach((listener) => listener([...files]));
    const active = files.find((file) => file.id === this.activeFile);
    if (active)
      this.activeFileListeners.forEach((listener) => listener(active));
    this.emitChange();
  }

  public localDelete(id: CrdtId): DeleteOp {
    const fileId = this.activeFile;
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
      console.error('[SignalRCrdtProvider] Failed to send awareness:', err);
    }
  }

  public async sendChatMessage(content: string): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    await this.connection.invoke('SendChatMessage', this.roomId, content);
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

  public onPeerLeft(listener: (peerId: string) => void): () => void {
    this.peerLeftListeners.add(listener);
    return () => this.peerLeftListeners.delete(listener);
  }

  public onPeerLeftByUser(
    listener: (userId: string, newRoomId?: string) => void
  ): () => void {
    this.peerLeftByUserListeners.add(listener);
    return () => this.peerLeftByUserListeners.delete(listener);
  }

  public onEvicted(listener: (newRoomId?: string) => void): () => void {
    this.evictedListeners.add(listener);
    return () => this.evictedListeners.delete(listener);
  }

  public onPeerJoined(
    listener: (
      peerId: string,
      displayName: string,
      color: string,
      userId?: string
    ) => void
  ): () => void {
    this.peerJoinedListeners.add(listener);
    return () => this.peerJoinedListeners.delete(listener);
  }

  public onRoomParticipants(
    listener: (participants: ParticipantInfo[]) => void
  ): () => void {
    this.roomParticipantsListeners.add(listener);
    return () => this.roomParticipantsListeners.delete(listener);
  }

  private registerHubHandlers(): void {
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

    this.connection.on('RoomFiles', (files: RoomEntry[]) =>
      this.updateFiles(files)
    );
    this.connection.on('FileAdded', (file: RoomEntry) =>
      this.updateFiles([...this.files, file])
    );
    this.connection.on('FileRenamed', (id: string, name: string) =>
      this.updateFiles(
        this.files.map((file) => (file.id === id ? { ...file, name } : file))
      )
    );
    this.connection.on('FileDeleted', (deletedIds: string[]) => {
      const ids = new Set(
        Array.isArray(deletedIds) ? deletedIds : [deletedIds]
      );
      this.updateFiles(this.files.filter((entry) => !ids.has(entry.id)));
    });

    this.connection.on(
      'LoadFileSnapshot',
      (fileId: string, snapshotJson: string) => {
        try {
          this.documentFor(fileId).fromSnapshot(snapshotJson);
          this.buffers.get(fileId)?.processPending();
          this.emitChange();
        } catch (err) {
          console.error('[SignalRCrdtProvider] Failed to load snapshot:', err);
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
              err
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
        const participants: ParticipantInfo[] = (rawParticipants || []).map(
          (p) => ({
            connectionId: String(p.connectionId ?? p.ConnectionId ?? ''),
            displayName: String(p.displayName ?? p.DisplayName ?? 'Anonymous'),
            color: String(p.color ?? p.Color ?? '#38bdf8'),
            userId: p.userId
              ? String(p.userId)
              : p.UserId
                ? String(p.UserId)
                : undefined,
          })
        );
        this.roomParticipantsListeners.forEach((l) => l(participants));
      }
    );

    this.connection.on(
      'PeerJoined',
      (peerId: string, displayName: string, color: string, userId?: string) => {
        this.peerJoinedListeners.forEach((l) =>
          l(peerId, displayName, color, userId)
        );
      }
    );

    this.connection.on('PeerLeft', (peerId: string) => {
      this.peerLeftListeners.forEach((l) => l(peerId));
    });

    this.connection.on(
      'PeerLeftByUser',
      (userId: string, newRoomId?: string) => {
        if (userId === this.siteId) {
          this.evictedListeners.forEach((l) => l(newRoomId));
          this.disconnect().catch(() => {});
        } else {
          this.peerLeftByUserListeners.forEach((l) => l(userId, newRoomId));
        }
      }
    );

    this.connection.onreconnecting(() => {
      this.emitStatus('reconnecting');
    });

    this.connection.onreconnected(async () => {
      try {
        await this.joinCurrentRoom();
        this.emitStatus('connected');
      } catch (err) {
        this.emitStatus('disconnected');
        console.error(
          '[SignalRCrdtProvider] Failed to rejoin room after reconnect:',
          err
        );
      }
    });

    this.connection.onclose(() => {
      this.emitStatus('disconnected');
    });
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
      this.siteId,
      this.displayName,
      this.color
    );
  }

  private async sendOp(fileId: string, op: CrdtOp): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) {
      console.warn('[SignalRCrdtProvider] Failed to send op: Not connected');
      return;
    }
    try {
      await this.connection.invoke('SendFileOp', this.roomId, fileId, op);
    } catch (err) {
      console.error('[SignalRCrdtProvider] Failed to send op:', err);
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    this.statusListeners.forEach((l) => l(status));
  }

  private emitChange(): void {
    this.changeListeners.forEach((l) => l());
  }
}
