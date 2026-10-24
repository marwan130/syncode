import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { GithubChangeStatus } from './changeTracker';
import { getGithubChanges } from './changeTracker';
import type { GithubRepositoryBaseline } from './githubTypes';

export function useGithubChanges(
  baseline: GithubRepositoryBaseline | null,
  entries: RoomEntry[],
  providerRef: RefObject<SignalRCrdtProvider | null>,
  connected: boolean
): GithubChangeStatus[] {
  const [changes, setChanges] = useState<GithubChangeStatus[]>([]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!baseline || !provider || !connected) {
      setChanges([]);
      return;
    }

    let timer = 0;
    let active = true;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void getGithubChanges(baseline, entries, (fileId) =>
          provider.getFileContent(fileId)
        )
          .then((next) => {
            if (active) setChanges(next);
          })
          .catch(() => {
            if (active) setChanges([]);
          });
      }, 350);
    };
    const unsubscribeDocuments = provider.onDocumentChange(update);
    const unsubscribeFiles = provider.onFilesChange(update);
    update();

    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribeDocuments();
      unsubscribeFiles();
    };
  }, [baseline, connected, entries, providerRef]);

  return changes;
}
