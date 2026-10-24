import { useCallback, useEffect, useState } from 'react';
import type { GithubChangeStatus } from './changeTracker';

export function useGithubStaging(changes: GithubChangeStatus[]) {
  const [stagedPaths, setStagedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const currentPaths = new Set(changes.map((change) => change.path));
    setStagedPaths((current) => {
      const next = new Set([...current].filter((path) => currentPaths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [changes]);

  const stageAll = useCallback(
    () => setStagedPaths(new Set(changes.map((change) => change.path))),
    [changes]
  );
  const unstageAll = useCallback(() => setStagedPaths(new Set()), []);
  const toggleStaged = useCallback((path: string) => {
    setStagedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return { stagedPaths, stageAll, unstageAll, toggleStaged };
}

export type GithubStagingState = ReturnType<typeof useGithubStaging>;
