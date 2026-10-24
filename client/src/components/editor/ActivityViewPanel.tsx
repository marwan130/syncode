import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { Icon } from '@iconify/react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { GithubChangeStatus } from '../../github/changeTracker';
import type { GithubStagingState } from '../../github/useGithubStaging';
import type { GithubRepositoryExplorerProps } from './fileExplorerTypes';
import { getEntryPath } from './editorLayoutStorage';
import { SidebarPanel } from './SidebarPanel';
import { getFileIcon } from './fileExplorerUtils';
import { GithubRepositoryExplorerAction } from '../github/GithubRepositoryExplorerAction';
import { GithubRepositoryExplorerStatus } from '../github/GithubRepositoryExplorerStatus';
import type { ActivityView } from './ActivityBar';

interface ActivityViewPanelProps {
  activeView: ActivityView | null;
  width: number;
  entries: RoomEntry[];
  activeFileId: string;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  github?: GithubRepositoryExplorerProps;
  githubStaging: GithubStagingState;
  canRunCode: boolean;
  runDisabledReason?: string;
  isRunningCode: boolean;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onOpenFile: (fileId: string, line: number) => void;
  onRunCode: () => void;
  onOpenTerminal: () => void;
}

export function ActivityViewPanel(props: ActivityViewPanelProps) {
  const { activeView } = props;
  const title = activeView ? ACTIVITY_TITLES[activeView] : '';
  return (
    <SidebarPanel
      isOpen={Boolean(activeView && activeView !== 'explorer')}
      width={props.width}
      onWidthChange={props.onWidthChange}
      onClose={props.onClose}
      label={title.toLowerCase()}
    >
      {activeView === 'search' && <WorkspaceSearch {...props} />}
      {activeView === 'source-control' && (
        <SourceControl
          github={props.github}
          entries={props.entries}
          onOpenFile={props.onOpenFile}
          staging={props.githubStaging}
        />
      )}
      {activeView === 'run' && <RunView {...props} />}
    </SidebarPanel>
  );
}

const ACTIVITY_TITLES: Record<ActivityView, string> = {
  explorer: 'Explorer',
  search: 'Search',
  'source-control': 'Source Control',
  run: 'Run',
};

function ViewHeading({ view }: { view: ActivityView }) {
  return <div className="activity-view-heading">{ACTIVITY_TITLES[view]}</div>;
}

function WorkspaceSearch({
  entries,
  activeFileId,
  providerRef,
  onOpenFile,
}: ActivityViewPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [resolvedQuery, setResolvedQuery] = useState('');
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setResults(findWorkspaceMatches(entries, query, provider));
        setResolvedQuery(query);
      }, 180);
    };
    refresh();
    const unsubscribe = provider.onDocumentChange(refresh);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [entries, providerRef, query]);

  return (
    <aside className="activity-view" aria-label="Search">
      <ViewHeading view="search" />
      <label className="activity-search-input">
        <span className="visually-hidden">Search in files</span>
        <Icon icon="codicon:search" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
          }}
          placeholder="Search"
          type="search"
          autoComplete="off"
        />
      </label>
      {query.trim() && resolvedQuery === query && (
        <div
          className="activity-search-results"
          role="list"
          aria-label="Search results"
        >
          {results.length ? (
            results.map((result) => (
              <button
                className={`activity-search-result${result.fileId === activeFileId ? ' is-active' : ''}`}
                key={`${result.fileId}:${result.line}`}
                type="button"
                role="listitem"
                onClick={() => onOpenFile(result.fileId, result.line)}
                title={`${result.path}, line ${result.line}`}
              >
                <strong>
                  {result.path}
                  <span>:{result.line}</span>
                </strong>
                <span>{result.text}</span>
              </button>
            ))
          ) : (
            <p className="activity-empty">No results found.</p>
          )}
        </div>
      )}
    </aside>
  );
}

interface SearchMatch {
  fileId: string;
  path: string;
  line: number;
  text: string;
}

function findWorkspaceMatches(
  entries: RoomEntry[],
  query: string,
  provider: SignalRCrdtProvider | null
): SearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !provider) return [];
  const matches: SearchMatch[] = [];
  for (const entry of entries) {
    if (entry.isFolder) continue;
    const content = provider.getFileContent(entry.id);
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLocaleLowerCase().includes(needle)) continue;
      matches.push({
        fileId: entry.id,
        path: getEntryPath(entry, entries),
        line: index + 1,
        text: lines[index].trim(),
      });
      if (matches.length >= 500) return matches;
    }
  }
  return matches;
}

function SourceControl({
  github,
  entries,
  onOpenFile,
  staging,
}: {
  github?: GithubRepositoryExplorerProps;
  entries: RoomEntry[];
  onOpenFile: (fileId: string, line: number) => void;
  staging: GithubStagingState;
}) {
  const changes = github?.changes ?? [];
  const entriesByPath = useMemo(
    () =>
      new Map(
        entries
          .filter((entry) => !entry.isFolder)
          .map((entry) => [getEntryPath(entry, entries), entry])
      ),
    [entries]
  );
  const stagedChanges = changes.filter((change) =>
    staging.stagedPaths.has(change.path)
  );
  const unstagedChanges = changes.filter(
    (change) => !staging.stagedPaths.has(change.path)
  );

  return (
    <aside className="activity-view" aria-label="Source Control">
      <ViewHeading view="source-control" />
      {github ? (
        <div className="activity-source-control">
          <GithubRepositoryExplorerAction
            {...github}
            changes={stagedChanges}
            triggerClassName="activity-source-control-heading"
            triggerContent={
              <>
                <strong>GITHUB</strong>
                {github.baseline && (
                  <span className="source-control-repository-name">
                    {github.baseline.owner}/{github.baseline.name}
                  </span>
                )}
              </>
            }
          />
          <GithubRepositoryExplorerStatus
            baseline={github.baseline}
            changes={changes}
          />
          {github.baseline && (
            <>
              <SourceControlChangeSection
                title="Staged Changes"
                changes={stagedChanges}
                entriesByPath={entriesByPath}
                onOpenFile={onOpenFile}
                onToggleStaged={staging.toggleStaged}
                onBulkAction={staging.unstageAll}
                bulkActionLabel="Unstage all changes"
                bulkActionIcon="codicon:remove"
              />
              <SourceControlChangeSection
                title="Changes"
                changes={unstagedChanges}
                entriesByPath={entriesByPath}
                onOpenFile={onOpenFile}
                onToggleStaged={staging.toggleStaged}
                onBulkAction={staging.stageAll}
                bulkActionLabel="Stage all changes"
                bulkActionIcon="codicon:add"
              />
              {stagedChanges.length > 0 && (
                <p className="source-control-commit-hint">
                  Open GITHUB to review and push staged changes.
                </p>
              )}
            </>
          )}
          {!github.baseline && (
            <p className="activity-empty">Open a GitHub repository to start tracking changes.</p>
          )}
        </div>
      ) : (
        <p className="activity-empty">Source control is unavailable.</p>
      )}
    </aside>
  );
}

function SourceControlChangeSection({
  title,
  changes,
  entriesByPath,
  onOpenFile,
  onToggleStaged,
  onBulkAction,
  bulkActionLabel,
  bulkActionIcon,
}: {
  title: string;
  changes: GithubChangeStatus[];
  entriesByPath: Map<string, RoomEntry>;
  onOpenFile: (fileId: string, line: number) => void;
  onToggleStaged: (path: string) => void;
  onBulkAction: () => void;
  bulkActionLabel: string;
  bulkActionIcon: string;
}) {
  return (
    <section className="source-control-change-section" aria-label={title}>
      <div className="source-control-section-heading">
        <strong>{title}</strong>
        <span>{changes.length}</span>
        {changes.length > 0 && (
          <button
            type="button"
            className="source-control-section-action"
            aria-label={bulkActionLabel}
            title={bulkActionLabel}
            onClick={onBulkAction}
          >
            <Icon icon={bulkActionIcon} aria-hidden="true" />
          </button>
        )}
      </div>
      {changes.map((change) => {
        const entry = entriesByPath.get(change.path);
        const changeLabel = change.kind === 'added' ? 'A' : change.kind === 'deleted' ? 'D' : 'M';
        return (
          <div className="source-control-change-row" key={change.path}>
            <button
              type="button"
              className="source-control-change-file"
              disabled={!entry}
              title={change.path}
              onClick={() => entry && onOpenFile(entry.id, 1)}
            >
              <Icon
                className="source-control-change-file-icon"
                icon={entry ? getFileIcon(entry, false) : 'vscode-icons:file-type-text'}
                aria-hidden="true"
              />
              <span>{change.path}</span>
              <strong className={`source-control-change-status is-${change.kind}`}>
                {changeLabel}
              </strong>
            </button>
            <button
              type="button"
              className="source-control-section-action source-control-change-action"
              aria-label={`${stagedLabel(title)} ${change.path}`}
              title={`${stagedLabel(title)} ${change.path}`}
              onClick={() => onToggleStaged(change.path)}
            >
              <Icon
                icon={title === 'Changes' ? 'codicon:add' : 'codicon:remove'}
                aria-hidden="true"
              />
            </button>
          </div>
        );
      })}
    </section>
  );
}

function stagedLabel(title: string): string {
  return title === 'Changes' ? 'Stage' : 'Unstage';
}

function RunView({
  canRunCode,
  runDisabledReason,
  isRunningCode,
  onRunCode,
  onOpenTerminal,
}: ActivityViewPanelProps) {
  return (
    <aside className="activity-view" aria-label="Run">
      <ViewHeading view="run" />
      <section className="activity-run-section" aria-label="Actions">
        <button
          type="button"
          className="activity-action-button"
          onClick={onRunCode}
          disabled={!canRunCode || isRunningCode}
          title={runDisabledReason}
        >
          <Icon
            icon={isRunningCode ? 'codicon:loading' : 'codicon:play'}
            aria-hidden="true"
          />
          {isRunningCode ? 'Running…' : 'Run active file'}
        </button>
        <button
          type="button"
          className="activity-action-button"
          onClick={onOpenTerminal}
        >
          <Icon icon="codicon:terminal" aria-hidden="true" />
          New terminal
        </button>
      </section>
    </aside>
  );
}
