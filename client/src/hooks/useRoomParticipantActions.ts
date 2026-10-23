import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import { userFacingError } from '../utils/userFacingError';
import { useAppFeedback } from '../components/shared/useAppFeedback';

export function useRoomParticipantActions(
  providerRef: RefObject<SignalRCrdtProvider | null>
) {
  const { showMessage } = useAppFeedback();
  const runAction = useCallback(
    async (
      action: (provider: SignalRCrdtProvider) => Promise<void>,
      message: string
    ) => {
      const provider = providerRef.current;
      if (!provider) return;
      try {
        await action(provider);
      } catch (error) {
        await showMessage(userFacingError(error, message));
      }
    },
    [providerRef, showMessage]
  );

  const toggleEditLock = useCallback(
    (connectionId: string) =>
      runAction(
        (provider) => provider.toggleParticipantEditLock(connectionId),
        'Could not update editing access. Try again.'
      ),
    [runAction]
  );

  const setAdminRole = useCallback(
    (connectionId: string, isAdmin: boolean) =>
      runAction(
        (provider) => provider.setParticipantAdmin(connectionId, isAdmin),
        'Could not update the admin role. Try again.'
      ),
    [runAction]
  );

  const kickParticipant = useCallback(
    (connectionId: string) =>
      runAction(
        (provider) => provider.kickParticipant(connectionId),
        'Could not remove that participant. Try again.'
      ),
    [runAction]
  );

  return { kickParticipant, setAdminRole, toggleEditLock };
}
