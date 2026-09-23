import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';

interface UseCrdtSyncProps {
  siteId: string;
  roomId: string;
  serverUrl?: string;
  displayName?: string;
  color?: string;
  enabled?: boolean;
}

interface UseCrdtSyncReturn {
  status: ConnectionStatus;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  evictedNewRoomId: string | null;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_BACKEND_URL || '';

export function useCrdtSync({
  siteId,
  roomId,
  serverUrl = DEFAULT_SERVER_URL,
  displayName,
  color,
  enabled = true,
}: UseCrdtSyncProps): UseCrdtSyncReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [evictedNewRoomId, setEvictedNewRoomId] = useState<string | null>(null);
  const providerRef = useRef<SignalRCrdtProvider | null>(null);

  useEffect(() => {
    if (!roomId || !siteId || !displayName || !enabled) return;

    const p = new SignalRCrdtProvider(
      siteId,
      roomId,
      serverUrl,
      displayName,
      color
    );
    providerRef.current = p;

    const unsubStatus = p.onStatusChange((s) => {
      setStatus(s);
      if (s === 'connecting' || s === 'connected') {
        setEvictedNewRoomId(null);
      }
    });

    const unsubEvicted = p.onEvicted((newRoomId) => {
      setEvictedNewRoomId(newRoomId || '');
    });

    p.connect().catch((err) => {
      console.error('[useCrdtSync] Failed to connect:', err);
    });

    return () => {
      unsubStatus();
      unsubEvicted();
      p.disconnect().catch(() => {});
      providerRef.current = null;
    };
  }, [siteId, roomId, serverUrl, displayName, color, enabled]);

  return {
    status,
    providerRef,
    evictedNewRoomId,
  };
}
