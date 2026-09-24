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

export class SignalRCrdtProvider {
  public readonly doc: CrdtDocument;
  public readonly siteId: string;
  private buffer: PendingBuffer;
  private connection: HubConnection;
  private roomId: string;
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
  private snapshotSaveTimer: ReturnType<typeof setTimeout> | null = null;
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

  constructor(
    siteId: string,
    roomId: string,
    serverUrl: string,
    displayName: string = `User ${siteId.slice(0, 6)}`,
    color: string = '#38bdf8'
  ) {
    this.siteId = siteId;
    this.roomId = roomId;
    this.displayName = displayName;
    this.color = color;
    this.doc = new CrdtDocument(siteId);
    this.buffer = new PendingBuffer(this.doc);

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
    if (this.snapshotSaveTimer) {
      clearTimeout(this.snapshotSaveTimer);
      this.snapshotSaveTimer = null;
    }
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
    this.emitStatus('disconnected');
  }

  public localInsert(originId: CrdtId | null, value: string): InsertOp {
    const op = this.doc.localInsert(originId, value);
    this.emitChange();
    this.sendOp(op).catch(() => {});
    this.scheduleSnapshotSave();
    return op;
  }

  public localDelete(id: CrdtId): DeleteOp {
    const op = this.doc.localDelete(id);
    this.emitChange();
    this.sendOp(op).catch(() => {});
    this.scheduleSnapshotSave();
    return op;
  }

  private scheduleSnapshotSave(): void {
    if (this.snapshotSaveTimer) clearTimeout(this.snapshotSaveTimer);
    this.snapshotSaveTimer = setTimeout(() => {
      if (this.connection.state === HubConnectionState.Connected) {
        this.connection
          .invoke('SaveSnapshot', this.roomId, this.doc.toSnapshot())
          .catch(() => {});
      }
    }, 1000);
  }

  public async sendAwareness(state: AwarenessState): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) return;
    try {
      await this.connection.invoke('UpdateAwareness', this.roomId, state);
    } catch (err) {
      console.error('[SignalRCrdtProvider] Failed to send awareness:', err);
    }
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
    this.connection.on('LoadSnapshot', (snapshotJson: string) => {
      try {
        this.doc.fromSnapshot(snapshotJson);
        this.buffer.processPending();
        this.emitChange();
      } catch (err) {
        console.error('[SignalRCrdtProvider] Failed to load snapshot:', err);
      }
    });

    this.connection.on('ReceiveOp', (op: CrdtOp) => {
      this.buffer.process(op);
      this.emitChange();
      this.scheduleSnapshotSave();
    });

    this.connection.on('RequestSnapshot', (targetConnectionId: string) => {
      if (this.connection.state !== HubConnectionState.Connected) return;
      this.connection
        .invoke(
          'SendSnapshotToPeer',
          this.roomId,
          targetConnectionId,
          this.doc.toSnapshot()
        )
        .catch((err) => {
          console.error('[SignalRCrdtProvider] Failed to send snapshot:', err);
        });
    });

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

  private async joinCurrentRoom(): Promise<void> {
    await this.connection.invoke(
      'JoinRoom',
      this.roomId,
      this.siteId,
      this.displayName,
      this.color
    );
  }

  private async sendOp(op: CrdtOp): Promise<void> {
    if (this.connection.state !== HubConnectionState.Connected) {
      console.warn('[SignalRCrdtProvider] Failed to send op: Not connected');
      return;
    }
    try {
      await this.connection.invoke('SendOp', this.roomId, op);
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
