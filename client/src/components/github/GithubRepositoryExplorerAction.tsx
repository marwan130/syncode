import { useState, type ReactNode } from 'react';
import type { GithubRepositoryExplorerProps } from '../editor/fileExplorerTypes';
import { ExplorerActionButton } from '../editor/ExplorerActionButton';
import { GithubRepositoryDialog } from './GithubRepositoryDialog';

export type GithubRepositoryExplorerActionProps = GithubRepositoryExplorerProps;

export function GithubRepositoryExplorerAction({
  roomId,
  accessKey,
  baseline,
  changes,
  canImport,
  onRequestAdminGrant,
  onImport,
  onBaselineChange,
  triggerClassName,
  triggerContent,
}: GithubRepositoryExplorerActionProps & {
  triggerClassName?: string;
  triggerContent?: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);

  return (
    <>
      <ExplorerActionButton
        kind="github-repository"
        label={baseline ? 'GitHub changes' : 'Open GitHub repository'}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {triggerContent}
      </ExplorerActionButton>
      <GithubRepositoryDialog
        isOpen={isOpen}
        roomId={roomId}
        accessKey={accessKey}
        baseline={baseline}
        changes={changes}
        canImport={canImport}
        onRequestAdminGrant={onRequestAdminGrant}
        onClose={() => setOpen(false)}
        onImport={onImport}
        onBaselineChange={onBaselineChange}
      />
    </>
  );
}
