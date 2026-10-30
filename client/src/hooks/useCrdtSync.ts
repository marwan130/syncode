import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';
import { userFacingError } from '../utils/userFacingError';
import { useAppActivity } from '../components/shared/useAppActivity';

export interface UseCrdtSyncProps {
  siteId: string;
  roomId: string;
  accessKey: string;
  serverUrl?: string;
  displayName?: string;
  color?: string;
  creatorToken?: string | null;
  enabled?: boolean;
}

export interface UseCrdtSyncReturn {
  status: ConnectionStatus;
  connectionError: string | null;
  wasKicked: boolean;
  providerRef: RefObject<SignalRCrdtProvider | null>;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_BACKEND_URL || '';

export function useCrdtSync({
  siteId,
  roomId,
  accessKey,
  serverUrl = DEFAULT_SERVER_URL,
  displayName,
  color,
  creatorToken,
  enabled = true,
}: UseCrdtSyncProps): UseCrdtSyncReturn {
  const { beginActivity, runActivity } = useAppActivity();
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [wasKicked, setWasKicked] = useState(false);
  const providerRef = useRef<SignalRCrdtProvider | null>(null);
  const profileRef = useRef({ displayName, color });

  useLayoutEffect(() => {
    profileRef.current = { displayName, color };
  }, [displayName, color]);

  useEffect(() => {
    if (!roomId || !siteId || !displayName || !enabled) return;

    const p = new SignalRCrdtProvider(
      siteId,
      roomId,
      accessKey,
      serverUrl,
      profileRef.current.displayName,
      profileRef.current.color,
      creatorToken,
      undefined
    );
    providerRef.current = p;

    const unsubStatus = p.onStatusChange((s) => {
      setStatus(s);
      if (s === 'connected') setConnectionError(null);
    });
    let stopSnapshotActivity: (() => void) | null = null;
    const unsubSnapshotSave = p.onSnapshotSaveChange((isSaving) => {
      if (isSaving && !stopSnapshotActivity)
        stopSnapshotActivity = beginActivity('Saving changes…');
      else if (!isSaving && stopSnapshotActivity) {
        stopSnapshotActivity();
        stopSnapshotActivity = null;
      }
    });
    const unsubKicked = p.onRoomKicked(() => setWasKicked(true));

    // React Strict Mode replays effects in development. Defer startup by one
    // microtask so the setup it immediately cleans up never opens a transport.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      runActivity('Connecting to room…', () => p.connect()).catch((err) => {
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
      unsubSnapshotSave();
      stopSnapshotActivity?.();
      unsubKicked();
      p.disconnect().catch(() => {});
      providerRef.current = null;
    };
  }, [
    siteId,
    roomId,
    accessKey,
    serverUrl,
    displayName,
    creatorToken,
    enabled,
    beginActivity,
    runActivity,
  ]);

  useEffect(() => {
    providerRef.current?.setLocalColor(color ?? '#38bdf8');
  }, [color]);

  return {
    status,
    connectionError,
    wasKicked,
    providerRef,
  };
}
