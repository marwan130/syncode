import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

interface UseCrdtSyncProps {
  siteId: string;
  roomId: string;
  accessKey: string;
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
  accessKey,
  serverUrl = DEFAULT_SERVER_URL,
  displayName,
  color,
  enabled = true,
}: UseCrdtSyncProps): UseCrdtSyncReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [evictedNewRoomId, setEvictedNewRoomId] = useState<string | null>(null);
  const providerRef = useRef<SignalRCrdtProvider | null>(null);
  const profileRef = useRef({ displayName, color });
  profileRef.current = { displayName, color };

  useEffect(() => {
    if (!roomId || !siteId || !displayName || !enabled) return;

    const p = new SignalRCrdtProvider(
      siteId,
      roomId,
      accessKey,
      serverUrl,
      profileRef.current.displayName,
      profileRef.current.color
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

    // React Strict Mode replays effects in development. Defer startup by one
    // microtask so the setup it immediately cleans up never opens a transport.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      p.connect().catch((err) => {
        if (!cancelled) {
          console.error('[useCrdtSync] Failed to connect:', errorMessage(err));
        }
      });
    });

    return () => {
      cancelled = true;
      unsubStatus();
      unsubEvicted();
      p.disconnect().catch(() => {});
      providerRef.current = null;
    };
  }, [siteId, roomId, accessKey, serverUrl, Boolean(displayName), enabled]);

  useEffect(() => {
    providerRef.current?.setLocalColor(color ?? '#38bdf8');
  }, [color]);

  return {
    status,
    providerRef,
    evictedNewRoomId,
  };
}
