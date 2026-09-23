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
      setPeers((prev) => {
        const next = new Map(prev);
        const existing = next.get(peerId);
        next.set(peerId, {
          ...state,
          userId: existing?.userId ?? state.userId,
        });
        return next;
      });
    });

    const unsubParticipants = provider.onRoomParticipants((list) => {
      setPeers(() => {
        const next = new Map<string, AwarenessState>();
        for (const p of list) {
          if (p.connectionId && p.connectionId !== provider.connectionId) {
            next.set(p.connectionId, {
              cursor: null,
              name: p.displayName,
              color: p.color,
              userId: p.userId,
            });
          }
        }
        return next;
      });
    });

    const unsubPeerJoined = provider.onPeerJoined(
      (peerId, name, color, userId) => {
        setPeers((prev) => {
          const next = new Map(prev);
          const existing = next.get(peerId);
          next.set(peerId, {
            cursor: existing?.cursor ?? null,
            name,
            color,
            userId,
          });
          return next;
        });
      }
    );

    const unsubPeerLeft = provider.onPeerLeft((peerId) => {
      setPeers((prev) => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    });

    const unsubPeerLeftByUser = provider.onPeerLeftByUser((userId) => {
      setPeers((prev) => {
        const next = new Map(prev);
        for (const [peerId, state] of next.entries()) {
          if (state.userId === userId) {
            next.delete(peerId);
          }
        }
        return next;
      });
    });

    return () => {
      unsubAwareness();
      unsubParticipants();
      unsubPeerJoined();
      unsubPeerLeft();
      unsubPeerLeftByUser();
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
          .catch(() => {});
      }, 50);
    },
    [providerRef, status, localName, localColor]
  );

  return { peers, broadcastCursor };
}
