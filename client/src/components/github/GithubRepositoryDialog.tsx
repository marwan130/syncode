import { useEffect, useRef } from 'react';
import type { GithubChangeStatus } from '../../github/changeTracker';
import type { GithubRepositoryBaseline } from '../../github/githubTypes';
import type { ImportedFileContent } from '../../import/folderImport';
import { GithubRepositoryDialogContent } from './GithubRepositoryDialogContent';
import { useGithubRepositoryDialog } from './useGithubRepositoryDialog';

export interface GithubRepositoryDialogProps {
  isOpen: boolean;
  roomId: string;
  accessKey: string;
  baseline: GithubRepositoryBaseline | null;
  changes: GithubChangeStatus[];
  canImport: boolean;
  onRequestAdminGrant: () => Promise<string>;
  onClose: () => void;
  onImport: (
    files: ImportedFileContent[],
    baseline: GithubRepositoryBaseline,
    onProgress?: (completedFiles: number) => void
  ) => Promise<void>;
  onBaselineChange: (baseline: GithubRepositoryBaseline) => void;
  forceRepositoryPicker?: boolean;
  initialRepositoryUrl?: string;
}

export function GithubRepositoryDialog({
  isOpen,
  roomId,
  accessKey,
  baseline,
  changes,
  canImport,
  onRequestAdminGrant,
  onClose,
  onImport,
  onBaselineChange,
  forceRepositoryPicker = false,
  initialRepositoryUrl = '',
}: GithubRepositoryDialogProps) {
  const dialog = useGithubRepositoryDialog({
    roomId,
    accessKey,
    baseline,
    changes,
    onRequestAdminGrant,
    onClose,
    onImport,
    onBaselineChange,
  });
  const { reviewRepositoryUrl, setRepositoryInput } = dialog;
  const reviewedInitialUrl = useRef('');
  const appliedInitialUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      reviewedInitialUrl.current = '';
      appliedInitialUrl.current = null;
      return;
    }
    if (appliedInitialUrl.current !== initialRepositoryUrl) {
      appliedInitialUrl.current = initialRepositoryUrl;
      setRepositoryInput(initialRepositoryUrl);
    }
    if (
      initialRepositoryUrl &&
      reviewedInitialUrl.current !== initialRepositoryUrl
    ) {
      reviewedInitialUrl.current = initialRepositoryUrl;
      void reviewRepositoryUrl(initialRepositoryUrl);
    }
  }, [initialRepositoryUrl, isOpen, reviewRepositoryUrl, setRepositoryInput]);
  if (!isOpen) return null;

  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !dialog.isBusy)
          dialog.close();
      }}
    >
      <section
        className={`project-import-dialog github-repository-dialog${dialog.preview ? ' has-preview' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-repository-title"
      >
        <GithubRepositoryDialogContent
          baseline={baseline}
          changes={changes}
          canImport={canImport}
          dialog={dialog}
          forceRepositoryPicker={forceRepositoryPicker}
        />
      </section>
    </div>
  );
}
