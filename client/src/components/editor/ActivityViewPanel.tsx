import { useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { Icon } from '@iconify/react';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { GithubRepositoryExplorerProps } from './fileExplorerTypes';
import type { GithubChangeStatus } from '../../github/changeTracker';
import { SidebarPanel } from './SidebarPanel';
import { GithubSourceControlView } from './GithubSourceControlView';
import type { ActivityView } from './ActivityBar';
import { getFileIcon } from './fileExplorerUtils';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import {
  DEFAULT_SEARCH_OPTIONS,
  findWorkspaceMatches,
  groupSearchMatches,
  highlightSearchLine,
  replaceMatchInText,
  replaceAllInText,
  searchPatternError,
  type SearchFileGroup,
  type SearchMatch,
  type SearchOptions,
} from './workspaceSearch';

export interface ActivityViewPanelProps {
  activeView: ActivityView | null;
  width: number;
  entries: RoomEntry[];
  activeFileId: string;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  github?: GithubRepositoryExplorerProps;
  canManageRepositories: boolean;
  canRunCode: boolean;
  runDisabledReason?: string;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onOpenFile: (fileId: string, line: number) => void;
  onRunCode: () => void;
  onOpenTerminal: () => void;
  onOpenGithub: (repositoryUrl?: string) => void;
  onOpenChange: (change: GithubChangeStatus) => void;
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
        <aside className="activity-view" aria-label="Source Control">
          <ViewHeading view="source-control" />
          <GithubSourceControlView
            github={props.github}
            canManageRepositories={props.canManageRepositories}
            onOpenGithub={props.onOpenGithub}
            onOpenChange={props.onOpenChange}
          />
        </aside>
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
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [resolvedQuery, setResolvedQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [replaceError, setReplaceError] = useState<string | null>(null);

  const patternError = useMemo(
    () => searchPatternError(query, options),
    [query, options]
  );

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || patternError) {
      setResults([]);
      return;
    }
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setResults(findWorkspaceMatches(entries, query, provider, options));
        setResolvedQuery(query);
      }, 180);
    };
    refresh();
    const unsubscribe = provider.onDocumentChange(refresh);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [entries, providerRef, query, options, patternError]);

  const groups = useMemo(() => groupSearchMatches(results), [results]);
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries]
  );

  const handleReplaceAll = () => {
    const provider = providerRef.current;
    if (!provider || !query.trim() || patternError) return;
    setReplaceError(null);
    try {
      for (const group of groups) {
        const currentContent = provider.getFileContent(group.fileId);
        const nextContent = replaceAllInText(
          currentContent,
          query,
          replacement,
          options
        );
        if (nextContent !== currentContent) {
          provider.replaceFileText(group.fileId, nextContent);
        }
      }
    } catch {
      setReplaceError('Could not replace text in the workspace. Try again.');
    }
  };

  const handleReplaceFile = (fileId: string) => {
    const provider = providerRef.current;
    if (!provider || !query.trim() || patternError) return;
    setReplaceError(null);
    try {
      const currentContent = provider.getFileContent(fileId);
      const nextContent = replaceAllInText(
        currentContent,
        query,
        replacement,
        options
      );
      if (nextContent !== currentContent) {
        provider.replaceFileText(fileId, nextContent);
      }
    } catch {
      setReplaceError('Could not replace text in this file. Try again.');
    }
  };

  const handleReplaceMatch = (match: SearchMatch) => {
    const provider = providerRef.current;
    if (!provider || !query.trim() || patternError) return;
    setReplaceError(null);
    try {
      const currentContent = provider.getFileContent(match.fileId);
      const nextContent = replaceMatchInText(
        currentContent,
        query,
        replacement,
        options,
        match.line,
        match.column
      );
      if (nextContent !== currentContent)
        provider.replaceFileText(match.fileId, nextContent);
    } catch {
      setReplaceError('Could not replace this match. Try again.');
    }
  };

  return (
    <aside className="activity-view" aria-label="Search">
      <ViewHeading view="search" />
      <form
        className="activity-search-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="activity-search-row">
          <div className="activity-search-field">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              type="text"
              autoComplete="off"
              aria-label="Search"
            />
            <div className="activity-search-options">
              <button
                type="button"
                className={`activity-search-btn${options.matchCase ? ' is-active' : ''}`}
                aria-label="Match Case"
                title="Match Case (Alt+C)"
                aria-pressed={options.matchCase}
                onClick={() =>
                  setOptions((opt) => ({ ...opt, matchCase: !opt.matchCase }))
                }
              >
                <Icon icon="codicon:case-sensitive" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`activity-search-btn${options.wholeWord ? ' is-active' : ''}`}
                aria-label="Match Whole Word"
                title="Match Whole Word (Alt+W)"
                aria-pressed={options.wholeWord}
                onClick={() =>
                  setOptions((opt) => ({ ...opt, wholeWord: !opt.wholeWord }))
                }
              >
                <Icon icon="codicon:whole-word" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`activity-search-btn${options.isRegex ? ' is-active' : ''}`}
                aria-label="Use Regular Expression"
                title="Use Regular Expression (Alt+R)"
                aria-pressed={options.isRegex}
                onClick={() =>
                  setOptions((opt) => ({ ...opt, isRegex: !opt.isRegex }))
                }
              >
                <Icon icon="codicon:regex" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div style={{ width: 24, flex: '0 0 24px' }} aria-hidden="true" />
        </div>

        <div className="activity-search-row">
          <div className="activity-search-field">
            <input
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="Replace"
              type="text"
              autoComplete="off"
              aria-label="Replace"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.altKey)) {
                  event.preventDefault();
                  handleReplaceAll();
                }
              }}
            />
            <div className="activity-search-options">
              <button
                type="button"
                className={`activity-search-btn${options.preserveCase ? ' is-active' : ''}`}
                aria-label="Preserve Case"
                title="Preserve Case (Alt+P)"
                aria-pressed={options.preserveCase}
                onClick={() =>
                  setOptions((opt) => ({
                    ...opt,
                    preserveCase: !opt.preserveCase,
                  }))
                }
              >
                <Icon icon="codicon:preserve-case" aria-hidden="true" />
              </button>
            </div>
          </div>
          <button
            type="button"
            className="activity-search-action-btn"
            aria-label="Replace All"
            title="Replace All (Ctrl+Alt+Enter)"
            disabled={!query.trim() || results.length === 0}
            onClick={handleReplaceAll}
          >
            <Icon icon="codicon:replace-all" aria-hidden="true" />
          </button>
        </div>
      </form>

      {patternError && (
        <div className="activity-search-error" role="alert">
          <Icon icon="codicon:error" aria-hidden="true" />
          <span>{patternError}</span>
        </div>
      )}

      {replaceError && (
        <div className="activity-search-error" role="alert">
          <Icon icon="codicon:warning" aria-hidden="true" />
          <span>{replaceError}</span>
        </div>
      )}

      {query.trim() && !patternError && resolvedQuery === query && (
        <ScrollbarPanel
          className="activity-search-results"
          aria-label="Search results"
        >
          {groups.length ? (
            <>
              <p className="activity-search-summary">
                {results.length} {results.length === 1 ? 'result' : 'results'}{' '}
                in {groups.length} {groups.length === 1 ? 'file' : 'files'}
              </p>
              {groups.map((group) => (
                <SearchFileResults
                  key={group.fileId}
                  group={group}
                  entry={entriesById.get(group.fileId)}
                  query={resolvedQuery}
                  options={options}
                  activeFileId={activeFileId}
                  collapsed={collapsed.has(group.fileId)}
                  onToggle={() =>
                    setCollapsed((current) =>
                      toggleCollapsed(current, group.fileId)
                    )
                  }
                  onOpenFile={onOpenFile}
                  onReplaceFile={() => handleReplaceFile(group.fileId)}
                  onReplaceMatch={handleReplaceMatch}
                />
              ))}
            </>
          ) : (
            <p className="activity-empty">No results found.</p>
          )}
        </ScrollbarPanel>
      )}
    </aside>
  );
}

function SearchFileResults({
  group,
  entry,
  query,
  options,
  activeFileId,
  collapsed,
  onToggle,
  onOpenFile,
  onReplaceFile,
  onReplaceMatch,
}: {
  group: SearchFileGroup;
  entry?: RoomEntry;
  query: string;
  options: SearchOptions;
  activeFileId: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenFile: (fileId: string, line: number) => void;
  onReplaceFile: () => void;
  onReplaceMatch: (match: SearchMatch) => void;
}) {
  return (
    <section className="activity-search-file" aria-label={group.path}>
      <button
        className={`activity-search-file-header${group.fileId === activeFileId ? ' is-active' : ''}`}
        type="button"
        aria-expanded={!collapsed}
        title={group.path}
        onClick={onToggle}
      >
        <Icon
          icon={`codicon:chevron-${collapsed ? 'right' : 'down'}`}
          aria-hidden="true"
        />
        <Icon
          className="activity-search-file-icon"
          icon={
            entry ? getFileIcon(entry, false) : 'vscode-icons:file-type-text'
          }
          aria-hidden="true"
        />
        <span className="activity-search-file-name">{group.name}</span>
        {group.parentPath ? (
          <span className="activity-search-file-path">{group.parentPath}</span>
        ) : null}
        <span className="activity-search-file-count">
          {group.matches.length}
        </span>
        <span className="activity-search-file-actions">
          <button
            type="button"
            className="activity-search-row-action-btn"
            title="Replace All in File"
            aria-label={`Replace all in ${group.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onReplaceFile();
            }}
          >
            <Icon icon="codicon:replace-all" aria-hidden="true" />
          </button>
        </span>
      </button>
      {collapsed
        ? null
        : group.matches.map((match) => (
            <div
              className="activity-search-match"
              key={`${match.fileId}:${match.line}:${match.column}`}
              title={`${match.path}:${match.line}`}
              onClick={() => onOpenFile(match.fileId, match.line)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onOpenFile(match.fileId, match.line);
                }
              }}
            >
              <span className="activity-search-match-line">{match.line}</span>
              <span className="activity-search-match-text">
                {highlightSearchLine(match.text, query, options).map(
                  (part, index) =>
                    part.match ? (
                      <mark key={`${match.line}-${index}`}>{part.text}</mark>
                    ) : (
                      <span key={`${match.line}-${index}`}>{part.text}</span>
                    )
                )}
              </span>
              <span className="activity-search-match-actions">
                <button
                  type="button"
                  className="activity-search-row-action-btn"
                  title="Replace"
                  aria-label={`Replace match on line ${match.line}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReplaceMatch(match);
                  }}
                >
                  <Icon icon="codicon:replace" aria-hidden="true" />
                </button>
              </span>
            </div>
          ))}
    </section>
  );
}

function toggleCollapsed(current: Set<string>, fileId: string): Set<string> {
  const next = new Set(current);
  if (next.has(fileId)) next.delete(fileId);
  else next.add(fileId);
  return next;
}

function RunView({
  canRunCode,
  runDisabledReason,
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
          disabled={!canRunCode}
          title={runDisabledReason}
        >
          <Icon icon="codicon:play" aria-hidden="true" />
          Run active file
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
