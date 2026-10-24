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
    baseline: GithubRepositoryBaseline
  ) => Promise<void>;
  onBaselineChange: (baseline: GithubRepositoryBaseline) => void;
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
        className="project-import-dialog github-repository-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-repository-title"
      >
        <GithubRepositoryDialogContent
          baseline={baseline}
          changes={changes}
          canImport={canImport}
          dialog={dialog}
        />
      </section>
    </div>
  );
}
