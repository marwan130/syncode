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
import {
  INITIAL_EDITOR_GROUP,
  closeEditorGroupFile,
  openEditorGroupFile,
  pruneEditorGroupFiles,
  removeEditorGroup,
  resizeEditorGroupBoundary,
  splitEditorGroup,
} from '../components/editor/editorGroups';
import type { EditorGroupState } from '../components/editor/editorGroups';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';
import type {
  GithubChangeReviewTab,
  GithubChangeStatus,
} from '../github/changeTracker';
import type { GithubRepositoryBaseline } from '../github/githubTypes';

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
  const [projectRootName, setProjectRootName] = useState('');
  const [activeFileId, setActiveFileId] = useState('');
  const activeFileIdRef = useRef(activeFileId);
  const [editorGroups, setEditorGroups] = useState<EditorGroupState[]>([
    INITIAL_EDITOR_GROUP,
  ]);
  const [reviewTabs, setReviewTabs] = useState<GithubChangeReviewTab[]>([]);
  const editorGroupsRef = useRef(editorGroups);
  const [activeEditorGroupId, setActiveEditorGroupIdState] = useState(
    INITIAL_EDITOR_GROUP.id
  );
  const activeEditorGroupIdRef = useRef(activeEditorGroupId);
  const pendingActions = useRef(new Map<string, Promise<unknown>>());

  useLayoutEffect(() => {
    activeFileIdRef.current = activeFileId;
    editorGroupsRef.current = editorGroups;
    activeEditorGroupIdRef.current = activeEditorGroupId;
  }, [activeEditorGroupId, activeFileId, editorGroups]);

  const setGroups = useCallback(
    (update: (current: EditorGroupState[]) => EditorGroupState[]) => {
      setEditorGroups((current) => {
        const next = update(current);
        editorGroupsRef.current = next;
        return next;
      });
    },
    []
  );

  const setActiveEditorGroup = useCallback(
    (groupId: string) => {
      activeEditorGroupIdRef.current = groupId;
      setActiveEditorGroupIdState(groupId);
      const nextFileId =
        editorGroupsRef.current.find((group) => group.id === groupId)
          ?.activeFileId ?? '';
      setActiveFileId(
        nextFileId.startsWith('source-control:') ? '' : nextFileId
      );
      if (nextFileId && !nextFileId.startsWith('source-control:'))
        providerRef.current?.setActiveFile(nextFileId);
    },
    [providerRef]
  );

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const offRootName = provider.onProjectRootNameChange(setProjectRootName);
    const offFiles = provider.onFilesChange((next) => {
      setEntries(next);
      const validFileIds = new Set([
        ...next.filter((entry) => !entry.isFolder).map((entry) => entry.id),
        ...reviewTabs.map((tab) => tab.id),
      ]);
      setGroups((current) => pruneEditorGroupFiles(current, validFileIds));

      const activeGroupFileId =
        editorGroupsRef.current.find(
          (group) => group.id === activeEditorGroupIdRef.current
        )?.activeFileId ?? '';
      if (activeGroupFileId.startsWith('source-control:')) return;

      const preferredFileId = getStoredActiveFileId(roomId);
      if (preferredFileId && validFileIds.has(preferredFileId)) {
        provider.setActiveFile(preferredFileId);
        setActiveFileId(preferredFileId);
        setGroups((current) =>
          openEditorGroupFile(
            current,
            activeEditorGroupIdRef.current,
            preferredFileId
          )
        );
        return;
      }

      if (validFileIds.has(activeFileIdRef.current)) return;
      const fallback = next.find((entry) => !entry.isFolder);
      setActiveFileId(fallback?.id ?? '');
      if (fallback) {
        setGroups((current) =>
          openEditorGroupFile(
            current,
            activeEditorGroupIdRef.current,
            fallback.id
          )
        );
      }
    });
    const offActive = provider.onActiveFileChange((file) => {
      setActiveFileId(file.id);
      setGroups((current) =>
        openEditorGroupFile(current, activeEditorGroupIdRef.current, file.id)
      );
      storeActiveFileId(roomId, file.id);
    });
    return () => {
      offRootName();
      offFiles();
      offActive();
    };
  }, [providerRef, reviewTabs, roomId, setGroups, status]);

  const openFile = useCallback(
    (fileId: string, groupId = activeEditorGroupIdRef.current) => {
      activeEditorGroupIdRef.current = groupId;
      setActiveEditorGroupIdState(groupId);
      setGroups((current) => openEditorGroupFile(current, groupId, fileId));
      setActiveFileId(fileId);
      providerRef.current?.setActiveFile(fileId);
    },
    [providerRef, setGroups]
  );

  const closeFileTab = useCallback(
    (fileId: string, groupId: string) => {
      const currentGroup = editorGroupsRef.current.find(
        (group) => group.id === groupId
      );
      if (!currentGroup) return;
      const nextGroups = closeEditorGroupFile(
        editorGroupsRef.current,
        groupId,
        fileId
      );
      setGroups(() => nextGroups);
      if (fileId.startsWith('source-control:'))
        setReviewTabs((current) => current.filter((tab) => tab.id !== fileId));
      if (currentGroup.activeFileId !== fileId) return;
      const nextActiveFileId =
        nextGroups.find((group) => group.id === groupId)?.activeFileId ?? '';
      setActiveFileId(
        nextActiveFileId.startsWith('source-control:') ? '' : nextActiveFileId
      );
      if (nextActiveFileId && !nextActiveFileId.startsWith('source-control:'))
        providerRef.current?.setActiveFile(nextActiveFileId);
    },
    [providerRef, setGroups]
  );

  const openReviewTab = useCallback(
    (tab: GithubChangeReviewTab, groupId = activeEditorGroupIdRef.current) => {
      setReviewTabs((current) => [
        ...current.filter((existing) => existing.id !== tab.id),
        tab,
      ]);
      activeEditorGroupIdRef.current = groupId;
      setActiveEditorGroupIdState(groupId);
      setGroups((current) => openEditorGroupFile(current, groupId, tab.id));
      setActiveFileId('');
    },
    [setGroups]
  );

  const updateReviewTabs = useCallback(
    (changes: GithubChangeStatus[], baseline: GithubRepositoryBaseline) => {
      setReviewTabs((current) => {
        const updated = current.map((tab) => {
          const change = changes.find((item) => item.path === tab.change.path);
          return change ? { ...tab, change, baseline } : tab;
        });
        return updated.some((tab, index) => tab !== current[index])
          ? updated
          : current;
      });
    },
    []
  );

  const splitWorkspace = useCallback(
    (groupId = activeEditorGroupIdRef.current) => {
      const newGroupId = `group-${crypto.randomUUID()}`;
      const next = splitEditorGroup(
        editorGroupsRef.current,
        groupId,
        newGroupId
      );
      if (next === editorGroupsRef.current) return;
      editorGroupsRef.current = next;
      setEditorGroups(next);
      setActiveEditorGroup(newGroupId);
    },
    [setActiveEditorGroup]
  );

  const closeEditorGroup = useCallback(
    (groupId: string) => {
      const result = removeEditorGroup(editorGroupsRef.current, groupId);
      if (result.groups === editorGroupsRef.current) return;
      editorGroupsRef.current = result.groups;
      setEditorGroups(result.groups);
      if (activeEditorGroupIdRef.current !== groupId) return;
      setActiveEditorGroup(result.activeGroupId);
    },
    [setActiveEditorGroup]
  );

  const resizeEditorGroups = useCallback(
    (leftGroupId: string, deltaPixels: number, totalWidth: number) => {
      if (totalWidth <= 0) return;
      setGroups((current) =>
        resizeEditorGroupBoundary(
          current,
          leftGroupId,
          (deltaPixels / totalWidth) * 100
        )
      );
    },
    [setGroups]
  );

  const handleDropFile = openFile;

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
    projectRootName,
    setEntries,
    activeFileId,
    setActiveFileId,
    editorGroups,
    activeEditorGroupId,
    setActiveEditorGroup,
    reviewTabs,
    openFile,
    openReviewTab,
    updateReviewTabs,
    closeFileTab,
    splitWorkspace,
    closeEditorGroup,
    resizeEditorGroups,
    handleDropFile,
    runFileAction,
    createEntry,
  };
}
