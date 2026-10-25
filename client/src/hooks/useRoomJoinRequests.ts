import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  RoomJoinRequest,
  SignalRCrdtProvider,
  ConnectionStatus,
} from '../providers/SignalRCrdtProvider';

export function useRoomJoinRequests(
  providerRef: RefObject<SignalRCrdtProvider | null>,
  status: ConnectionStatus
) {
  const [requests, setRequests] = useState<RoomJoinRequest[]>([]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || status === 'disconnected') {
      setRequests([]);
      return;
    }

    return provider.onRoomJoinRequestsChanged(setRequests);
  }, [providerRef, status]);

  return {
    requests,
    approve: (requestId: string) =>
      providerRef.current?.approveRoomJoinRequest(requestId) ?? Promise.resolve(),
    reject: (requestId: string) =>
      providerRef.current?.rejectRoomJoinRequest(requestId) ?? Promise.resolve(),
  };
}
