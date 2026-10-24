import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { RoomEntry } from '../providers/SignalRCrdtProvider';
import type { GithubChangeStatus } from './changeTracker';
import { useGithubChanges } from './useGithubChanges';
import type { GithubRepositoryBaseline } from './githubTypes';
import type { ImportedFileContent } from '../import/folderImport';

export interface GithubRepositoryExplorerOptions {
  roomId: string;
  accessKey: string;
  canImport: boolean;
  closePreview: () => void;
  importFiles: (
    files: ImportedFileContent[],
    baseline: GithubRepositoryBaseline
  ) => Promise<void>;
}

export function useGithubRepository(
  providerRef: RefObject<SignalRCrdtProvider | null>,
  entries: RoomEntry[],
  status: ConnectionStatus,
  explorer: GithubRepositoryExplorerOptions
) {
  const [baseline, setBaseline] = useState<GithubRepositoryBaseline | null>(null);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    return provider.onGithubRepositoryChange(setBaseline);
  }, [providerRef, status]);

  const changes: GithubChangeStatus[] = useGithubChanges(
    baseline,
    entries,
    providerRef,
    status === 'connected'
  );

  const requestAdminGrant = () => {
    const provider = providerRef.current;
    if (!provider)
      throw new Error('Connect to the room before importing a repository.');
    return provider.createGithubRepositoryAdminGrant();
  };

  const importRepository = async (
    files: ImportedFileContent[],
    repositoryBaseline: GithubRepositoryBaseline
  ) => {
    explorer.closePreview();
    await explorer.importFiles(files, repositoryBaseline);
  };

  return {
    baseline,
    changes,
    setBaseline,
    explorer: {
      roomId: explorer.roomId,
      accessKey: explorer.accessKey,
      baseline,
      changes,
      canImport: explorer.canImport,
      onRequestAdminGrant: requestAdminGrant,
      onImport: importRepository,
      onBaselineChange: setBaseline,
    },
  };
}
