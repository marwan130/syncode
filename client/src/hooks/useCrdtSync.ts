import { useEffect, useRef, useState, useCallback } from 'react';
import { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';
import type { CrdtId } from '../crdt/CrdtId';
import type { InsertOp, DeleteOp } from '../crdt/CrdtDocument';

interface UseCrdtSyncProps {
  siteId: string;
  roomId: string;
  serverUrl?: string;
}

interface UseCrdtSyncReturn {
  status: ConnectionStatus;
  visibleText: string;
  localInsert: (originId: CrdtId | null, value: string) => Promise<InsertOp>;
  localDelete: (id: CrdtId) => Promise<DeleteOp>;
  providerRef: React.RefObject<SignalRCrdtProvider | null>;
}

import type React from 'react';

const DEFAULT_SERVER_URL = import.meta.env.VITE_BACKEND_URL || '';

export function useCrdtSync({
  siteId,
  roomId,
  serverUrl = DEFAULT_SERVER_URL,
}: UseCrdtSyncProps): UseCrdtSyncReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [visibleText, setVisibleText] = useState('');
  const providerRef = useRef<SignalRCrdtProvider | null>(null);

  useEffect(() => {
    if (!roomId || !siteId) return;

    const p = new SignalRCrdtProvider(siteId, roomId, serverUrl);
    providerRef.current = p;

    const unsubStatus = p.onStatusChange(setStatus);
    const unsubChange = p.onDocumentChange(() => {
      setVisibleText(p.doc.toVisibleString());
    });

    p.connect().catch((err) => {
      console.error('[useCrdtSync] Failed to connect:', err);
    });

    return () => {
      unsubStatus();
      unsubChange();
      p.disconnect().catch(() => {});
      providerRef.current = null;
    };
  }, [siteId, roomId, serverUrl]);

  const localInsert = useCallback(
    async (originId: CrdtId | null, value: string): Promise<InsertOp> => {
      if (!providerRef.current) throw new Error('Provider not initialized');
      return providerRef.current.localInsert(originId, value);
    },
    []
  );

  const localDelete = useCallback(async (id: CrdtId): Promise<DeleteOp> => {
    if (!providerRef.current) throw new Error('Provider not initialized');
    return providerRef.current.localDelete(id);
  }, []);

  return {
    status,
    visibleText,
    localInsert,
    localDelete,
    providerRef,
  };
}
