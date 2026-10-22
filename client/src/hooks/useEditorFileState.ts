import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';
import {
  getStoredActiveFileId,
  storeActiveFileId,
} from '../components/editor/editorLayoutStorage';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';

export interface EditorFileStateOptions {
  roomId: string;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
}

export function useEditorFileState({
  roomId,
  providerRef,
  status,
}: EditorFileStateOptions) {
  const [entries, setEntries] = useState<RoomEntry[]>([]);
  const [activeFileId, setActiveFileId] = useState('');
  const activeFileIdRef = useRef(activeFileId);
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [splitFileId, setSplitFileId] = useState<string | null>(null);
  const [isSplitWorkspaceOpen, setSplitWorkspaceOpen] = useState(false);
  const [activeEditorGroup, setActiveEditorGroup] = useState<
    'primary' | 'secondary'
  >('primary');
  const [splitWidth, setSplitWidth] = useState(50);
  const pendingActions = useRef(new Map<string, Promise<unknown>>());

  useLayoutEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const offFiles = provider.onFilesChange((next) => {
      setEntries(next);
      setOpenFileIds((current) =>
        current.filter((id) =>
          next.some((entry) => entry.id === id && !entry.isFolder)
        )
      );
      setSplitFileId((current) =>
        current && next.some((entry) => entry.id === current && !entry.isFolder)
          ? current
          : null
      );
      const preferredFileId = getStoredActiveFileId(roomId);
      if (
        preferredFileId &&
        next.some((entry) => entry.id === preferredFileId && !entry.isFolder)
      ) {
        provider.setActiveFile(preferredFileId);
        setActiveFileId(preferredFileId);
        setOpenFileIds((current) =>
          current.includes(preferredFileId)
            ? current
            : [...current, preferredFileId]
        );
        return;
      }
      const activeFileStillExists = next.some(
        (entry) => entry.id === activeFileIdRef.current && !entry.isFolder
      );
      if (activeFileStillExists) return;

      const fallback = next.find((entry) => !entry.isFolder);
      setActiveFileId(fallback?.id ?? '');
      if (fallback)
        setOpenFileIds((current) =>
          current.includes(fallback.id) ? current : [...current, fallback.id]
        );
    });
    const offActive = provider.onActiveFileChange((file) => {
      setActiveFileId(file.id);
      setOpenFileIds((current) =>
        current.includes(file.id) ? current : [...current, file.id]
      );
      storeActiveFileId(roomId, file.id);
    });
    return () => {
      offFiles();
      offActive();
    };
  }, [providerRef, roomId, status]);

  const openFile = useCallback(
    (fileId: string, group = activeEditorGroup) => {
      setOpenFileIds((current) =>
        current.includes(fileId) ? current : [...current, fileId]
      );
      setActiveEditorGroup(group);
      if (group === 'secondary' && isSplitWorkspaceOpen) {
        setSplitFileId(fileId);
      } else {
        if (splitFileId === fileId) setSplitFileId(null);
        setActiveFileId(fileId);
        providerRef.current?.setActiveFile(fileId);
      }
    },
    [activeEditorGroup, isSplitWorkspaceOpen, providerRef, splitFileId]
  );

  const closeFileTab = useCallback(
    (fileId: string) => {
      const index = openFileIds.indexOf(fileId);
      const next = openFileIds.filter((id) => id !== fileId);
      setOpenFileIds(next);
      if (splitFileId === fileId) setSplitFileId(null);
      if (activeFileId === fileId) {
        const nextActive = next[Math.min(index, next.length - 1)];
        if (nextActive) {
          setActiveFileId(nextActive);
          providerRef.current?.setActiveFile(nextActive);
        } else {
          setActiveFileId('');
        }
      }
    },
    [activeFileId, openFileIds, providerRef, splitFileId]
  );

  const handleDropFile = useCallback(
    (fileId: string, group: 'primary' | 'secondary') => {
      setOpenFileIds((current) =>
        current.includes(fileId) ? current : [...current, fileId]
      );
      if (group === 'primary') setSplitWorkspaceOpen(true);
      setSplitFileId(fileId);
      setActiveEditorGroup('secondary');
    },
    []
  );

  const runFileAction = useCallback(
    <T>(key: string, action: () => Promise<T>): Promise<T | void> => {
      const pending = pendingActions.current.get(key);
      if (pending) return pending as Promise<T | void>;
      const operation = action().finally(() => {
        if (pendingActions.current.get(key) === operation)
          pendingActions.current.delete(key);
      });
      pendingActions.current.set(key, operation);
      return operation;
    },
    []
  );

  const createEntry = useCallback(
    (parentId: string | null, name: string, isFolder: boolean) => {
      const provider = providerRef.current;
      if (!provider)
        return Promise.reject(new Error('Not connected to a room.'));
      return runFileAction(
        `create:${isFolder ? 'folder' : 'file'}:${parentId ?? 'root'}`,
        () => provider.createEntry(name, parentId, isFolder)
      );
    },
    [providerRef, runFileAction]
  );

  return {
    entries,
    setEntries,
    activeFileId,
    setActiveFileId,
    openFileIds,
    setOpenFileIds,
    splitFileId,
    setSplitFileId,
    isSplitWorkspaceOpen,
    setSplitWorkspaceOpen,
    activeEditorGroup,
    setActiveEditorGroup,
    splitWidth,
    setSplitWidth,
    openFile,
    closeFileTab,
    handleDropFile,
    runFileAction,
    createEntry,
  };
}
