import type { DragEvent } from 'react';
import type { RoomEntry } from '../../providers/SignalRCrdtProvider';
import { userFacingError } from '../../utils/userFacingError';
import { useAppFeedback } from '../shared/useAppFeedback';
import { getMovableEntry } from './fileExplorerUtils';

export interface UseFileExplorerMoveOptions {
  entries: RoomEntry[];
  canEdit: boolean;
  onMove: (entry: RoomEntry, parentId: string | null) => Promise<void>;
}

export function useFileExplorerMove({
  entries,
  canEdit,
  onMove,
}: UseFileExplorerMoveOptions) {
  const { showMessage } = useAppFeedback();

  const moveEntry = (entry: RoomEntry, parentId: string | null) =>
    onMove(entry, parentId).catch((error: unknown) => {
      void showMessage(
        userFacingError(error, 'Could not move that file or folder.')
      );
    });

  const onDrop = (event: DragEvent, parentId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit) return;
    const entry = getMovableEntry(
      entries,
      event.dataTransfer.getData('text/plain'),
      parentId
    );
    if (entry) void moveEntry(entry, parentId);
  };

  const onDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (canEdit) event.preventDefault();
  };

  return {
    moveEntry,
    onDragOver,
    onDrop,
    onRootDrop: (event: DragEvent<HTMLLIElement>) => onDrop(event, null),
  };
}
