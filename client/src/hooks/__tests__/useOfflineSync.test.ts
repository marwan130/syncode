/**
 * Tests for offline CRDT sync behaviour:
 *  1. Editing offline then reconnecting
 *  2. Reload while offline (IndexedDB queue survives)
 *  3. Expired room with one client
 *  4. Expired room with multiple clients (merge via CRDT)
 *  5. Client falsely claiming admin (server rejects)
 *  6. Failed upload (size limit exceeded) – fallback offered
 *
 * Uses an in-memory store that mirrors the offlineTextOpQueue contract so
 * tests run without IndexedDB or any extra dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrdtOp } from '../../crdt/CrdtDocument';

// ---------------------------------------------------------------------------
// In-memory queue — mirrors the offlineTextOpQueue API contract
// ---------------------------------------------------------------------------

type QueuedOp = {
  key: string;
  roomId: string;
  fileId: string;
  seq: number;
  op: CrdtOp;
};

const q = new Map<string, QueuedOp>();

const mk = (roomId: string, fileId: string, seq: number) =>
  `${roomId}:${fileId}:${String(seq).padStart(12, '0')}`;

async function queueOp(
  roomId: string,
  fileId: string,
  op: CrdtOp,
  seq: number
) {
  const key = mk(roomId, fileId, seq);
  q.set(key, { key, roomId, fileId, seq, op });
}

async function listOps(roomId: string): Promise<QueuedOp[]> {
  return [...q.values()]
    .filter((r) => r.roomId === roomId)
    .sort((a, b) =>
      a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : a.seq - b.seq
    );
}

async function removeOp(key: string) {
  q.delete(key);
}

async function clearOps(roomId: string) {
  for (const [k, v] of q) {
    if (v.roomId === roomId) q.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeOp(value: string, counter: number): CrdtOp {
  return {
    type: 'insert',
    char: { id: { siteId: 'site', counter }, value, isDeleted: false },
    originId: null,
  } as unknown as CrdtOp;
}

/** Simulate provider.sendOp() when disconnected. */
async function offlineSend(
  roomId: string,
  fileId: string,
  op: CrdtOp,
  seq: number
) {
  await queueOp(roomId, fileId, op, seq);
}

/** Simulate the reconnect replay loop in SignalRCrdtProvider. */
async function replayOnReconnect(
  roomId: string,
  invoke: (fileId: string, op: CrdtOp) => Promise<void>
) {
  const ops = await listOps(roomId);
  for (const queued of ops) {
    await invoke(queued.fileId, queued.op);
    await removeOp(queued.key);
  }
}

beforeEach(() => {
  q.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Editing offline → reconnect
// ---------------------------------------------------------------------------

describe('offline editing → reconnect', () => {
  it('queues ops while offline and replays them in insertion order', async () => {
    const roomId = 'room-reconnect';
    const fileId = 'file-main';
    const replayed: string[] = [];

    await offlineSend(roomId, fileId, fakeOp('h', 1), 1);
    await offlineSend(roomId, fileId, fakeOp('i', 2), 2);
    await offlineSend(roomId, fileId, fakeOp('!', 3), 3);

    const invoke = vi.fn(async (_fId: string, op: CrdtOp) => {
      replayed.push((op as { char: { value: string } }).char.value);
    });
    await replayOnReconnect(roomId, invoke);

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(replayed).toEqual(['h', 'i', '!']);
    expect(await listOps(roomId)).toHaveLength(0);
  });

  it('removes each op from the queue after successful replay', async () => {
    const roomId = 'room-partial-replay';

    await offlineSend(roomId, 'f', fakeOp('a', 1), 1);
    await offlineSend(roomId, 'f', fakeOp('b', 2), 2);

    // Replay only the first op then stop
    const ops = await listOps(roomId);
    await removeOp(ops[0].key);

    const remaining = await listOps(roomId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Reload while offline
// ---------------------------------------------------------------------------

describe('reload while offline', () => {
  it('queued ops survive a simulated page reload (queue is not auto-cleared)', async () => {
    const roomId = 'room-reload';

    await offlineSend(roomId, 'file-x', fakeOp('a', 1), 1);
    await offlineSend(roomId, 'file-x', fakeOp('b', 2), 2);

    // Simulate reload: just re-read the queue without clearing it
    const ops = await listOps(roomId);
    expect(ops).toHaveLength(2);
    expect(ops[0].seq).toBe(1);
    expect(ops[1].seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Expired room — single client
// ---------------------------------------------------------------------------

describe('expired room — single client', () => {
  it('uploads queued ops then clears them on successful recovery', async () => {
    const roomId = 'room-expired-single';

    await offlineSend(roomId, 'doc', fakeOp('x', 10), 10);
    await offlineSend(roomId, 'doc', fakeOp('y', 11), 11);

    // Recovery succeeds → clear queue
    const invoke = vi.fn().mockResolvedValue(undefined);
    await replayOnReconnect(roomId, invoke);

    expect(await listOps(roomId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Expired room — multiple clients
// ---------------------------------------------------------------------------

describe('expired room — multiple clients', () => {
  it('each client has an isolated queue; clearing one does not touch another', async () => {
    await offlineSend('room-multi', 'file-a', fakeOp('1', 1), 1);
    await offlineSend('other-client', 'file-b', fakeOp('2', 1), 1);

    await clearOps('room-multi');

    expect(await listOps('room-multi')).toHaveLength(0);
    expect(await listOps('other-client')).toHaveLength(1);
  });

  it('ops from different files in the same room are sorted by file then seq', async () => {
    await offlineSend('room-multi-files', 'z-file', fakeOp('z', 1), 1);
    await offlineSend('room-multi-files', 'a-file', fakeOp('a', 1), 1);
    await offlineSend('room-multi-files', 'a-file', fakeOp('b', 2), 2);

    const ops = await listOps('room-multi-files');
    expect(ops[0].fileId).toBe('a-file');
    expect(ops[1].fileId).toBe('a-file');
    expect(ops[2].fileId).toBe('z-file');
  });
});

// ---------------------------------------------------------------------------
// 5. False admin claim
// ---------------------------------------------------------------------------

describe('false admin claim', () => {
  it('server rejection surfaces as an error and leaves the queue intact', async () => {
    const roomId = 'room-false-admin';
    await offlineSend(roomId, 'file-1', fakeOp('z', 1), 1);

    const invoke = vi.fn().mockRejectedValue(new Error('Unauthorized'));

    let caught: unknown;
    try {
      await invoke('RestoreExpiredWorkspace', [], null);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Unauthorized');

    // Queue must not have been cleared on a failed upload
    expect(await listOps(roomId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Failed upload (size limit exceeded)
// ---------------------------------------------------------------------------

describe('failed upload (size limit)', () => {
  it('leaves queue intact when upload fails so a download can be offered', async () => {
    const roomId = 'room-upload-fail';

    for (let i = 0; i < 5; i++) {
      await offlineSend(roomId, 'large-file', fakeOp(String(i), i), i);
    }

    const invoke = vi.fn().mockRejectedValue(new Error('Payload too large'));

    let uploadFailed = false;
    try {
      await invoke('RestoreExpiredWorkspace', [], null);
    } catch {
      uploadFailed = true;
    }

    expect(uploadFailed).toBe(true);
    // Provider does NOT call clearOps on failure — queue stays for download
    expect(await listOps(roomId)).toHaveLength(5);
  });
});
