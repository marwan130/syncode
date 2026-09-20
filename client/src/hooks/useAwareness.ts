import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  SignalRCrdtProvider,
  AwarenessState,
  ConnectionStatus,
} from '../providers/SignalRCrdtProvider';
import type { CursorAnchor } from '../crdt/CursorAnchor';

interface UseAwarenessProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
}

export function useAwareness({
  providerRef,
  status,
  localName,
  localColor,
}: UseAwarenessProps): {
  peers: Map<string, AwarenessState>;
  broadcastCursor: (anchor: CursorAnchor | null) => void;
} {
  const [peers, setPeers] = useState<Map<string, AwarenessState>>(new Map());
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || status !== 'connected') {
      setPeers(new Map());
      return;
    }

    const unsubAwareness = provider.onAwarenessUpdate((peerId, state) => {
      setPeers((prev) => new Map(prev).set(peerId, state));
    });

    const unsubPeerLeft = provider.onPeerLeft((peerId) => {
      setPeers((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    });

    return () => {
      unsubAwareness();
      unsubPeerLeft();
      if (throttleRef.current) clearTimeout(throttleRef.current);
      setPeers(new Map());
    };
  }, [status, providerRef]);

  // throttled send so we don't spam the server on every keystroke
  const broadcastCursor = useCallback(
    (anchor: CursorAnchor | null) => {
      const provider = providerRef.current;
      if (!provider || status !== 'connected') return;

      if (throttleRef.current) clearTimeout(throttleRef.current);
      throttleRef.current = setTimeout(() => {
        provider
          .sendAwareness({ cursor: anchor, name: localName, color: localColor })
          .catch(() => { });
      }, 50);
    },
    [providerRef, status, localName, localColor]
  );

  return { peers, broadcastCursor };
}
