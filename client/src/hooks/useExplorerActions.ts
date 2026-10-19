import { useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import { userFacingError } from '../utils/userFacingError';

type RunFileAction = <T>(
  key: string,
  action: () => Promise<T>
) => Promise<T | void>;

interface UseExplorerActionsOptions {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  runFileAction: RunFileAction;
}

export function useExplorerActions({
  providerRef,
  runFileAction,
}: UseExplorerActionsOptions) {
  const renameEntry = useCallback(
    (entry: RoomEntry, name: string) =>
      runFileAction(`rename:${entry.id}`, () => {
        const provider = providerRef.current;
        if (!provider)
          return Promise.reject(new Error('Not connected to a room.'));
        return provider.renameEntry(entry.id, name);
      }),
    [providerRef, runFileAction]
  );

  const deleteEntry = useCallback(
    (entry: RoomEntry) => {
      const prompt = entry.isFolder
        ? `Delete folder "${entry.name}" and everything inside it?`
        : `Delete ${entry.name}?`;
      if (!window.confirm(prompt)) return;

      void runFileAction(`delete:${entry.id}`, () => {
        const provider = providerRef.current;
        if (!provider)
          return Promise.reject(new Error('Not connected to a room.'));
        return provider.deleteEntry(entry.id);
      }).catch((error: unknown) =>
        window.alert(
          userFacingError(
            error,
            'Could not complete that file operation. Try again.'
          )
        )
      );
    },
    [providerRef, runFileAction]
  );

  const moveEntry = useCallback(
    (entry: RoomEntry, parentId: string | null) =>
      runFileAction(`move:${entry.id}`, () => {
        const provider = providerRef.current;
        if (!provider)
          return Promise.reject(new Error('Not connected to a room.'));
        return provider.moveEntry(entry.id, parentId);
      }),
    [providerRef, runFileAction]
  );

  return { renameEntry, deleteEntry, moveEntry };
}
