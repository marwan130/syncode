import { useEffect, useRef, useState, useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  SignalRCrdtProvider,
  AwarenessState,
  ConnectionStatus,
  ParticipantInfo,
} from '../providers/SignalRCrdtProvider';
import type { CursorAnchor } from '../crdt/CursorAnchor';

export interface UseAwarenessProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  localName: string;
  localColor: string;
}

function toAwarenessState(
  participant: ParticipantInfo,
  cursor: CursorAnchor | null = null
): AwarenessState {
  return {
    cursor,
    name: participant.displayName,
    color: participant.color,
    avatarUrl: participant.avatarUrl,
    isAdmin: participant.isAdmin,
    isLocked: participant.isLocked,
  };
}

export function deduplicateParticipants(
  participants: ParticipantInfo[],
  localConnectionId: string | null,
  localMemberId?: string | null
): ParticipantInfo[] {
  const localParticipant = participants.find(
    (participant) => participant.connectionId === localConnectionId
  );
  const knownLocalMemberId = localMemberId ?? localParticipant?.memberId;
  const memberIds = new Set(knownLocalMemberId ? [knownLocalMemberId] : []);
  return participants.filter((participant) => {
    if (
      !participant.connectionId ||
      participant.connectionId === localConnectionId
    )
      return false;
    if (participant.memberId && memberIds.has(participant.memberId))
      return false;
    if (participant.memberId) memberIds.add(participant.memberId);
    return true;
  });
}

export function useAwareness({
  providerRef,
  status,
  localName,
  localColor,
}: UseAwarenessProps): {
  peers: Map<string, AwarenessState>;
  localParticipant: AwarenessState | null;
  broadcastCursor: (anchor: CursorAnchor | null) => void;
} {
  const [peers, setPeers] = useState<Map<string, AwarenessState>>(new Map());
  const [localParticipant, setLocalParticipant] =
    useState<AwarenessState | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localMemberIdRef = useRef<string | null>(null);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || status === 'disconnected') {
      setPeers(new Map());
      setLocalParticipant(null);
      return;
    }

    const unsubAwareness = provider.onAwarenessUpdate((peerId, state) => {
      setPeers((prev) => {
        const next = new Map(prev);
        const existing = next.get(peerId);
        next.set(peerId, {
          ...state,
          avatarUrl: existing?.avatarUrl ?? state.avatarUrl,
          isAdmin: existing?.isAdmin ?? state.isAdmin,
          isLocked: existing?.isLocked ?? state.isLocked,
        });
        return next;
      });
    });

    const unsubParticipants = provider.onRoomParticipants((list) => {
      const current = list.find(
        (participant) => participant.connectionId === provider.connectionId
      );
      if (current?.memberId) localMemberIdRef.current = current.memberId;
      setLocalParticipant(current ? toAwarenessState(current) : null);
      setPeers((previous) => {
        const next = new Map<string, AwarenessState>();
        for (const p of deduplicateParticipants(
          list,
          provider.connectionId,
          localMemberIdRef.current
        )) {
          next.set(
            p.connectionId,
            toAwarenessState(p, previous.get(p.connectionId)?.cursor ?? null)
          );
        }
        return next;
      });
    });

    return () => {
      unsubAwareness();
      unsubParticipants();
      if (throttleRef.current) clearTimeout(throttleRef.current);
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

  return { peers, localParticipant, broadcastCursor };
}
