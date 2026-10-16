import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';
import { userFacingError } from '../utils/userFacingError';

interface UseCrdtSyncProps {
  siteId: string;
  userId: string;
  roomId: string;
  accessKey: string;
  serverUrl?: string;
  displayName?: string;
  color?: string;
  enabled?: boolean;
}

interface UseCrdtSyncReturn {
  status: ConnectionStatus;
  connectionError: string | null;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  evictedNewRoomId: string | null;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_BACKEND_URL || '';

export function useCrdtSync({
  siteId,
  userId,
  roomId,
  accessKey,
  serverUrl = DEFAULT_SERVER_URL,
  displayName,
  color,
  enabled = true,
}: UseCrdtSyncProps): UseCrdtSyncReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [evictedNewRoomId, setEvictedNewRoomId] = useState<string | null>(null);
  const providerRef = useRef<SignalRCrdtProvider | null>(null);
  const profileRef = useRef({ displayName, color });

  useLayoutEffect(() => {
    profileRef.current = { displayName, color };
  }, [displayName, color]);

  useEffect(() => {
    if (!roomId || !siteId || !displayName || !enabled) return;

    const p = new SignalRCrdtProvider(
      siteId,
      userId,
      roomId,
      accessKey,
      serverUrl,
      profileRef.current.displayName,
      profileRef.current.color
    );
    providerRef.current = p;

    const unsubStatus = p.onStatusChange((s) => {
      setStatus(s);
      if (s === 'connected') setConnectionError(null);
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
          setConnectionError(
            userFacingError(
              err,
              'Could not connect to the room. Check your connection and try again.'
            )
          );
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
  }, [siteId, userId, roomId, accessKey, serverUrl, displayName, enabled]);

  useEffect(() => {
    providerRef.current?.setLocalColor(color ?? '#38bdf8');
  }, [color]);

  return {
    status,
    connectionError,
    providerRef,
    evictedNewRoomId,
  };
}
