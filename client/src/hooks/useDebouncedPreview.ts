import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type {
  ConnectionStatus,
  RoomEntry,
} from '../providers/SignalRCrdtProvider';

interface UseDebouncedPreviewProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  enabled: boolean;
  activeFileId: string;
}

export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewProject {
  activeFilePath: string;
  source: string;
  files: PreviewFile[];
}

function getFilePath(fileId: string, files: RoomEntry[]): string {
  const entry = files.find((file) => file.id === fileId);
  if (!entry) return fileId;
  const parts = [entry.name];
  let parentId = entry.parentId;
  while (parentId) {
    const parent = files.find((file) => file.id === parentId && file.isFolder);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join('/');
}

function readProject(
  provider: SignalRCrdtProvider,
  activeFileId: string
): PreviewProject {
  const entries = provider.fileList;
  return {
    activeFilePath: getFilePath(activeFileId, entries),
    source: provider.getFileContent(activeFileId),
    files: entries
      .filter((file) => !file.isFolder)
      .map((file) => ({
        path: getFilePath(file.id, entries),
        content: provider.getFileContent(file.id),
      })),
  };
}

export function useDebouncedPreview({
  providerRef,
  status,
  enabled,
  activeFileId,
}: UseDebouncedPreviewProps): PreviewProject {
  const [project, setProject] = useState<PreviewProject>({
    activeFilePath: 'main.cpp',
    source: '',
    files: [],
  });

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !enabled) {
      setProject({ activeFilePath: 'main.cpp', source: '', files: [] });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleUpdate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setProject(readProject(provider, activeFileId));
        timer = null;
      }, 300);
    };

    setProject(readProject(provider, activeFileId));
    const unsubscribe = provider.onDocumentChange(scheduleUpdate);

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [providerRef, status, enabled, activeFileId]);

  return project;
}
