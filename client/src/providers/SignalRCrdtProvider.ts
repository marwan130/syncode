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
}

export class SignalRCrdtProvider {
  public readonly doc: CrdtDocument;
  private buffer: PendingBuffer;
  private connection: HubConnection;
  private roomId: string;
  private statusListeners: Set<(s: ConnectionStatus) => void> = new Set();
  private changeListeners: Set<() => void> = new Set();
  private awarenessListeners: Set<
    (peerId: string, state: AwarenessState) => void
  > = new Set();
  private peerLeftListeners: Set<(peerId: string) => void> = new Set();

  constructor(siteId: string, roomId: string, serverUrl: string) {
    this.roomId = roomId;
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
      this.emitStatus('connected');
      await this.connection.invoke('JoinRoom', this.roomId);
    } catch (err) {
      this.emitStatus('disconnected');
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.connection.state !== HubConnectionState.Disconnected) {
      await this.connection.stop();
    }
    this.emitStatus('disconnected');
  }

  public async localInsert(
    originId: CrdtId | null,
    value: string
  ): Promise<InsertOp> {
    const op = this.doc.localInsert(originId, value);
    this.emitChange();
    await this.sendOp(op);
    return op;
  }

  public async localDelete(id: CrdtId): Promise<DeleteOp> {
    const op = this.doc.localDelete(id);
    this.emitChange();
    await this.sendOp(op);
    return op;
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

  private registerHubHandlers(): void {
    this.connection.on('ReceiveOp', (op: CrdtOp) => {
      this.buffer.process(op);
      this.emitChange();
    });

    this.connection.on(
      'AwarenessUpdate',
      (peerId: string, state: AwarenessState) => {
        this.awarenessListeners.forEach((l) => l(peerId, state));
      }
    );

    this.connection.on('PeerLeft', (peerId: string) => {
      this.peerLeftListeners.forEach((l) => l(peerId));
    });

    this.connection.onreconnecting(() => {
      this.emitStatus('reconnecting');
    });

    this.connection.onreconnected(async () => {
      this.emitStatus('connected');
      try {
        await this.connection.invoke('JoinRoom', this.roomId);
      } catch (err) {
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
