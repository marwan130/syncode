import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  RoomJoinRequest,
  SignalRCrdtProvider,
  ConnectionStatus,
} from '../providers/SignalRCrdtProvider';

export function useRoomJoinRequests(
  providerRef: RefObject<SignalRCrdtProvider | null>,
  status: ConnectionStatus,
  isAdmin: boolean
) {
  const [requests, setRequests] = useState<RoomJoinRequest[]>([]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || status === 'disconnected') {
      setRequests([]);
      return;
    }

    const unsubscribe = provider.onRoomJoinRequestsChanged(setRequests);
    if (status === 'connected' && isAdmin)
      provider
        .getRoomJoinRequests()
        .then(setRequests)
        .catch(() => {});
    return unsubscribe;
  }, [providerRef, status, isAdmin]);

  return {
    requests,
    approve: (requestId: string) =>
      providerRef.current?.approveRoomJoinRequest(requestId) ??
      Promise.resolve(),
    reject: (requestId: string) =>
      providerRef.current?.rejectRoomJoinRequest(requestId) ??
      Promise.resolve(),
  };
}
