import { useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { GithubRepositoryExplorerProps } from './fileExplorerTypes';
import {
  getGithubCommitDetails,
  listGithubBranches,
  listGithubHistory,
  listGithubRepositories,
} from '../../github/repositoryBrowser';
import type {
  GithubBranchOption,
  GithubCommitDetails,
  GithubCommitHistoryItem,
  GithubRepositoryOption,
} from '../../github/repositoryBrowser';
import { useGithubAuth } from '../../github/useGithubAuth';
import { useAppActivity } from '../shared/useAppActivity';
import { userFacingError } from '../../utils/userFacingError';
import { GithubLoginButton } from '../github/GithubLoginButton';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { SourceControlPanel } from './SourceControlPanel';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';
import { moveMenuRadioFocus } from './menuKeyboardNavigation';
import { CommitHistoryGraph } from './CommitHistoryGraph';
import {
  buildScmHistoryGraphRows,
  getScmHistoryGraphWidth,
} from './scmHistoryGraph';
import { formatCommitAge } from '../../github/commitAge';
import { GithubRepositorySetup } from './GithubRepositorySetup';
import { GithubRepositoryUrlForm } from './GithubRepositoryUrlForm';
import { useGithubBranchActions } from './useGithubBranchActions';

export function GithubSourceControlRemoteActions({
  github,
  canManageRepositories,
  onOpenGithub,
  onTargetBranchChange,
}: {
  github: GithubRepositoryExplorerProps;
  canManageRepositories: boolean;
  onOpenGithub: (repositoryUrl?: string) => void;
  onTargetBranchChange: (branch: string) => void;
}) {
  const { account } = useGithubAuth();
  const { runActivity } = useAppActivity();
  const [repositories, setRepositories] = useState<GithubRepositoryOption[]>(
    []
  );
  const [branches, setBranches] = useState<GithubBranchOption[]>([]);
  const [history, setHistory] = useState<GithubCommitHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLoadingRef = useRef(false);
  const [selectedBranch, setSelectedBranch] = useState(
    github.baseline?.branch ?? ''
  );
  const [error, setError] = useState('');
  const [isRepositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const baseline = github.baseline;
  const repositoryOwner = baseline?.owner;
  const repositoryName = baseline?.name;
  const defaultBranch = baseline?.branch;
  const branchActions = useGithubBranchActions({
    baseline,
    repositories,
    selectedBranch,
    setSelectedBranch,
    setBranches,
    onTargetBranchChange,
    setError,
    canImport: github.canImport,
    onSelectBranch: github.onSelectBranch,
  });
  const {
    busy,
    branchDraft,
    setBranchDraft,
    renaming,
    setRenaming,
    renameDraft,
    setRenameDraft,
    openBranch,
    createBranch,
    saveRename,
    removeBranch,
  } = branchActions;

  useEffect(() => {
    onTargetBranchChange(defaultBranch ?? '');
  }, [defaultBranch, onTargetBranchChange]);

  useEffect(() => {
    let active = true;
    if (!account || !canManageRepositories) return;
    void runActivity('Loading GitHub repositories…', () =>
      listGithubRepositories()
    )
      .then((result) => {
        if (active) setRepositories(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            userFacingError(reason, 'Could not load GitHub repositories.')
          );
      });
    return () => {
      active = false;
    };
  }, [account, canManageRepositories, runActivity]);

  useEffect(() => {
    let active = true;
    if (!account || !repositoryOwner || !repositoryName || !defaultBranch)
      return;

    queueMicrotask(() => {
      if (!active) return;
      setHistory([]);
      setHistoryPage(1);
      setHistoryHasMore(false);
      setHistoryLoading(true);
    });
    historyLoadingRef.current = true;
    void runActivity('Loading branches and history…', () =>
      Promise.all([
        listGithubBranches(repositoryOwner, repositoryName),
        listGithubHistory(
          repositoryOwner,
          repositoryName,
          selectedBranch || defaultBranch,
          1
        ),
      ])
    )
      .then(([branchList, commits]) => {
        if (!active) return;
        setBranches(branchList);
        setHistory(commits);
        setHistoryHasMore(commits.length === 100);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            userFacingError(reason, 'Could not load GitHub branch information.')
          );
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
          historyLoadingRef.current = false;
        }
      });
    return () => {
      active = false;
      historyLoadingRef.current = false;
    };
  }, [
    account,
    defaultBranch,
    repositoryName,
    repositoryOwner,
    selectedBranch,
    runActivity,
  ]);

  const visibleRepositories =
    account && canManageRepositories ? repositories : [];
  const visibleBranches = account && baseline ? branches : [];
  const visibleHistory = account && baseline ? history : [];
  const repositoryPickerButton = (
    <div className="source-control-subpanel">
      <button
        type="button"
        className="source-control-panel-heading profile-leave-button"
        aria-haspopup="dialog"
        aria-expanded={isRepositoryPickerOpen}
        disabled={!canManageRepositories}
        onClick={() => setRepositoryPickerOpen(true)}
      >
        <strong>Choose repository</strong>
      </button>
    </div>
  );
  const repositoryPickerDialog = isRepositoryPickerOpen &&
    canManageRepositories && (
      <div
        className="editor-file-picker-backdrop source-control-repository-picker-backdrop"
        onClick={() => setRepositoryPickerOpen(false)}
      >
        <div
          className="editor-file-picker"
          style={{
            height: Math.min(420, visibleRepositories.length * 30 + 52),
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Select a GitHub repository"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRepositoryPickerOpen(false);
          }}
        >
          <div className="editor-file-picker-heading">
            <span>Select a repository</span>
            <button
              type="button"
              onClick={() => setRepositoryPickerOpen(false)}
            >
              Close
            </button>
          </div>
          <RepositoryPickerList
            repositories={visibleRepositories}
            onOpenGithub={(url) => {
              setRepositoryPickerOpen(false);
              onOpenGithub(url);
            }}
            className="editor-file-picker-list"
            filePicker
          />
        </div>
      </div>
    );
  const loadMoreHistory = async () => {
    if (
      !account ||
      !repositoryOwner ||
      !repositoryName ||
      !defaultBranch ||
      !historyHasMore ||
      historyLoadingRef.current
    )
      return;
    historyLoadingRef.current = true;
    setHistoryLoading(true);
    const nextPage = historyPage + 1;
    try {
      const commits = await listGithubHistory(
        repositoryOwner,
        repositoryName,
        selectedBranch || defaultBranch,
        nextPage
      );
      setHistory((current) => [...current, ...commits]);
      setHistoryPage(nextPage);
      setHistoryHasMore(commits.length === 100);
    } catch (reason) {
      setError(userFacingError(reason, 'Could not load older commits.'));
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoading(false);
    }
  };

  return (
    <>
      <SourceControlPanel
        title="Repositories"
        defaultOpen
        className={`source-control-repositories-panel${baseline ? '' : ' is-empty'}`}
      >
        <div className="source-control-repository-settings">
          {baseline && (
            <button
              type="button"
              className="activity-source-control-heading"
              disabled={!canManageRepositories}
              onClick={() =>
                onOpenGithub(
                  `https://github.com/${baseline.owner}/${baseline.name}`
                )
              }
            >
              <span className="source-control-repository-copy">
                <span className="source-control-repository-name">
                  {baseline.owner}/{baseline.name}
                </span>
                <span className="source-control-repository-branch">
                  {baseline.branch}
                </span>
              </span>
            </button>
          )}
          {!baseline ? (
            <GithubRepositorySetup
              accountSignedIn={Boolean(account)}
              canManageRepositories={canManageRepositories}
              github={github}
              onOpenGithub={onOpenGithub}
              onTargetBranchChange={onTargetBranchChange}
              repositoryPickerButton={repositoryPickerButton}
              error={error}
              setError={setError}
            />
          ) : account ? (
            <div
              className="source-control-remote-actions"
              aria-label="Repository and branch actions"
            >
              {repositoryPickerButton}
              <GithubRepositoryUrlForm
                onOpenGithub={onOpenGithub}
                disabled={!canManageRepositories}
              />
              <BranchPicker
                branches={visibleBranches}
                selectedBranch={selectedBranch}
                disabled={busy}
                onSelect={(branch) => {
                  setError('');
                  setSelectedBranch(branch);
                  onTargetBranchChange(branch);
                }}
              />
              {github.canImport && selectedBranch !== baseline.branch && (
                <button
                  className="source-control-open-branch"
                  type="button"
                  disabled={busy}
                  onClick={() => void openBranch(selectedBranch)}
                >
                  Open {selectedBranch} in room
                </button>
              )}
              <div className="source-control-branch-management">
                <div className="source-control-branch-create">
                  <input
                    aria-label="New branch name"
                    placeholder="New branch name"
                    value={branchDraft}
                    onChange={(event) =>
                      setBranchDraft(event.currentTarget.value)
                    }
                  />
                  <button
                    className="project-action-button"
                    type="button"
                    disabled={busy || !branchDraft.trim()}
                    onClick={() => void createBranch()}
                  >
                    Create
                  </button>
                </div>
                <div
                  className="source-control-branch-list"
                  aria-label="Repository branches"
                >
                  {visibleBranches.map((branch) => (
                    <div
                      className="source-control-branch-row"
                      key={branch.name}
                    >
                      <span
                        className="source-control-branch-name"
                        title={branch.name}
                      >
                        {branch.name}
                        {branch.isProtected ? ' · protected' : ''}
                      </span>
                      {renaming === branch.name ? (
                        <div className="source-control-branch-actions is-renaming">
                          <input
                            aria-label={`Rename ${branch.name}`}
                            value={renameDraft}
                            onChange={(event) =>
                              setRenameDraft(event.currentTarget.value)
                            }
                          />
                          <button
                            className="project-action-button"
                            type="button"
                            disabled={busy || !renameDraft.trim()}
                            onClick={() => void saveRename()}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div className="source-control-branch-actions">
                          <button
                            className="project-action-button"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setRenaming(branch.name);
                              setRenameDraft(branch.name);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="project-action-button"
                            type="button"
                            disabled={busy}
                            onClick={() => void removeBranch(branch)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="source-control-remote-actions">
              {!github.hasWorkspaceFiles && (
                <GithubRepositoryUrlForm
                  onOpenGithub={onOpenGithub}
                  disabled={!canManageRepositories}
                />
              )}
              <div className="source-control-connect">
                <p>
                  Sign in to browse repositories, branches, and GitHub history.
                </p>
                <GithubLoginButton
                  returnTo={`${window.location.pathname}${window.location.search}`}
                  pushScope={baseline.isPrivate ? 'repo' : 'public_repo'}
                  className="profile-github-button"
                  disabled={!canManageRepositories}
                />
              </div>
            </div>
          )}
          {account &&
            repositoryPickerDialog &&
            createPortal(repositoryPickerDialog, document.body)}
          {error && (
            <p className="source-control-message is-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </SourceControlPanel>
      {baseline && account && (
        <CommitHistoryPanel
          history={visibleHistory}
          branches={visibleBranches}
          baseline={baseline}
          currentBranch={selectedBranch || baseline.branch}
          hasMore={historyHasMore}
          isLoading={historyLoading}
          onLoadMore={() => void loadMoreHistory()}
        />
      )}
    </>
  );
}
function BranchPicker({
  branches,
  selectedBranch,
  disabled,
  onSelect,
}: {
  branches: GithubBranchOption[];
  selectedBranch: string;
  disabled: boolean;
  onSelect: (branch: string) => void;
}) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  }, [isOpen]);

  useOutsidePointerDismiss(
    isOpen,
    () => setIsOpen(false),
    (target) =>
      Boolean(
        target &&
        (pickerRef.current?.contains(target as Node) ||
          menuRef.current?.contains(target as Node))
      )
  );

  useEffect(() => {
    if (!isOpen) return;
    const closeMenu = () => setIsOpen(false);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, [isOpen]);

  const openMenu = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const desiredHeight = Math.min(240, branches.length * 32 + 8);
    const above = Math.max(0, bounds.top - 8);
    const below = Math.max(0, window.innerHeight - bounds.bottom - 8);
    const opensAbove = above > below;
    const height = Math.max(
      0,
      Math.min(desiredHeight, opensAbove ? above : below)
    );
    const width = Math.min(bounds.width, window.innerWidth - 16);
    const left = Math.max(
      8,
      Math.min(bounds.left, window.innerWidth - width - 8)
    );
    setMenuPosition({
      position: 'fixed',
      zIndex: 1000,
      left,
      top: opensAbove ? bounds.top - height : bounds.bottom,
      width,
      height,
      maxHeight: height,
    });
    setIsOpen(true);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    moveMenuRadioFocus(event, menuRef.current);
  };

  return (
    <div className="source-control-branch-picker" ref={pickerRef}>
      <label
        className="source-control-branch-select-label"
        htmlFor={`branch-picker-${id}`}
      >
        Branch
      </label>
      <button
        id={`branch-picker-${id}`}
        ref={triggerRef}
        className="source-control-branch-picker-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={`branch-menu-${id}`}
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          openMenu();
        }}
      >
        <span>{selectedBranch || 'Select branch'}</span>
        <Icon icon="codicon:chevron-down" aria-hidden="true" />
      </button>
      {isOpen &&
        createPortal(
          <div
            id={`branch-menu-${id}`}
            ref={menuRef}
            className="source-control-branch-picker-menu"
            style={menuPosition}
            role="menu"
            aria-label="Branches"
            onKeyDown={handleMenuKeyDown}
          >
            <ScrollbarPanel className="source-control-branch-menu-scroll">
              {branches.map((branch) => {
                const isSelected = branch.name === selectedBranch;
                return (
                  <button
                    key={branch.name}
                    className={`source-control-branch-option${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    disabled={disabled}
                    onClick={() => {
                      onSelect(branch.name);
                      setIsOpen(false);
                      triggerRef.current?.focus();
                    }}
                  >
                    {branch.name}
                  </button>
                );
              })}
            </ScrollbarPanel>
          </div>,
          document.body
        )}
    </div>
  );
}

function RepositoryPickerList({
  repositories,
  onOpenGithub,
  className = 'source-control-repository-list',
  filePicker = false,
}: {
  repositories: GithubRepositoryOption[];
  onOpenGithub: (repositoryUrl?: string) => void;
  className?: string;
  filePicker?: boolean;
}) {
  return (
    <ScrollbarPanel
      className={`${className}${filePicker ? ' source-control-repository-list' : ''}`}
      aria-label="Your GitHub repositories"
    >
      {repositories.map((repository) => (
        <button
          key={`${repository.owner}/${repository.name}`}
          type="button"
          className={`source-control-repository-option${filePicker ? ' editor-file-picker-repository-option' : ''}`}
          onClick={() =>
            onOpenGithub(
              `https://github.com/${repository.owner}/${repository.name}`
            )
          }
        >
          {filePicker ? (
            <span className="editor-file-picker-entry">
              <span className="editor-file-picker-name">
                {repository.owner}/{repository.name}
              </span>
              <span className="editor-file-picker-path">
                {repository.defaultBranch}
              </span>
            </span>
          ) : (
            <>
              <span>
                {repository.owner}/{repository.name}
              </span>
              <span>{repository.defaultBranch}</span>
            </>
          )}
        </button>
      ))}
      {repositories.length === 0 && (
        <p className="source-control-message">No repositories found.</p>
      )}
    </ScrollbarPanel>
  );
}

function CommitHistoryPanel({
  history,
  branches,
  baseline,
  currentBranch,
  hasMore,
  isLoading,
  onLoadMore,
}: {
  history: GithubCommitHistoryItem[];
  branches: GithubBranchOption[];
  baseline: NonNullable<GithubRepositoryExplorerProps['baseline']>;
  currentBranch: string;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}) {
  const graphColors = useCommitGraphTheme();
  const refsBySha = new Map<string, string[]>();
  for (const branch of branches) {
    const refs = refsBySha.get(branch.sha) ?? [];
    refs.push(branch.name);
    refsBySha.set(branch.sha, refs);
  }
  const graphRows = buildScmHistoryGraphRows(
    history,
    branches,
    currentBranch,
    graphColors
  );
  const graphWidth = getScmHistoryGraphWidth(graphRows);
  return (
    <div className="source-control-history-section">
      <SourceControlPanel
        title="Commit History"
        defaultOpen={false}
        className="source-control-history-panel"
      >
        <ScrollbarPanel
          className="source-control-history-list"
          aria-label="GitHub commit history"
          onViewportScroll={(event) => {
            const viewport = event.currentTarget;
            if (
              hasMore &&
              !isLoading &&
              viewport.scrollHeight -
                viewport.scrollTop -
                viewport.clientHeight <
                80
            )
              onLoadMore();
          }}
        >
          {history.length === 0 ? (
            <p className="source-control-empty">No commits found.</p>
          ) : (
            <div className="source-control-git-log">
              {history.map((commit, index) => {
                const graphRow = graphRows[index];
                if (!graphRow) return null;
                const refs = refsBySha.get(commit.sha) ?? [];
                return (
                  <div
                    className="source-control-commit-history-row"
                    key={commit.sha}
                  >
                    <CommitHistoryGraph row={graphRow} width={graphWidth} />
                    <CommitHistoryEntry
                      commit={commit}
                      refs={refs}
                      currentBranch={currentBranch}
                      branch={currentBranch}
                      owner={baseline.owner}
                      repository={baseline.name}
                      url={`https://github.com/${baseline.owner}/${baseline.name}/commit/${commit.sha}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {isLoading && history.length > 0 && (
            <p className="source-control-empty" role="status">
              Loading older commits…
            </p>
          )}
        </ScrollbarPanel>
      </SourceControlPanel>
    </div>
  );
}

function useCommitGraphTheme(): string[] {
  const readTheme = () => {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    return [
      toRgbColour(styles.getPropertyValue('--accent'), 'rgb(0, 122, 204)'),
      toRgbColour(styles.getPropertyValue('--warning'), 'rgb(255, 180, 40)'),
      toRgbColour(styles.getPropertyValue('--success'), 'rgb(80, 160, 90)'),
      toRgbColour(styles.getPropertyValue('--danger'), 'rgb(210, 80, 80)'),
    ];
  };
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function toRgbColour(value: string, fallback: string): string {
  const color = value.trim();
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const channels = expanded
      .match(/.{2}/g)
      ?.map((channel) => Number.parseInt(channel, 16));
    if (channels?.length === 3)
      return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
  }
  const rgb = color.match(/^rgba?\((\s*\d+\s*,\s*\d+\s*,\s*\d+)/i)?.[1];
  return rgb ? `rgb(${rgb})` : fallback;
}

function CommitHistoryEntry({
  commit,
  refs,
  currentBranch,
  branch,
  owner,
  repository,
  url,
}: {
  commit: GithubCommitHistoryItem;
  refs: string[];
  currentBranch: string;
  branch: string;
  owner: string;
  repository: string;
  url: string;
}) {
  const tooltipId = useId();
  const [tooltip, setTooltip] = useState<{ top: number; left: number } | null>(
    null
  );
  const [details, setDetails] = useState<GithubCommitDetails | null>(null);
  const [detailsState, setDetailsState] = useState<
    'idle' | 'loading' | 'loaded' | 'failed'
  >('idle');
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const label = commit.message.split('\n')[0];
  const loadDetails = () => {
    if (detailsState !== 'idle') return;
    setDetailsState('loading');
    void getGithubCommitDetails(owner, repository, commit.sha)
      .then((result) => {
        setDetails(result);
        setDetailsState('loaded');
      })
      .catch(() => setDetailsState('failed'));
  };
  const showTooltip = (
    event: FocusEvent<HTMLAnchorElement> | MouseEvent<HTMLAnchorElement>
  ) => {
    loadDetails();
    const bounds = event.currentTarget.getBoundingClientRect();
    const tooltipWidth = 360;
    const left =
      bounds.right + tooltipWidth + 12 <= window.innerWidth
        ? bounds.right
        : Math.max(8, bounds.left - tooltipWidth);
    const top = Math.max(8, Math.min(bounds.top, window.innerHeight - 180));
    setTooltip({ top, left });
  };

  return (
    <>
      <a
        ref={triggerRef}
        className="source-control-commit-row"
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${label}, ${commit.author}, ${formatCommitDate(commit.date)}`}
        aria-describedby={tooltip ? tooltipId : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={(event) => {
          if (!(
            event.relatedTarget instanceof Node &&
            document.getElementById(tooltipId)?.contains(event.relatedTarget)
          )) {
            setTooltip(null);
          }
        }}
        onFocus={showTooltip}
        onBlur={(event) => {
          if (!(
            event.relatedTarget instanceof Node &&
            document.getElementById(tooltipId)?.contains(event.relatedTarget)
          )) {
            setTooltip(null);
          }
        }}
      >
        <span className="source-control-commit-message">{label}</span>
        {refs.map((ref) => (
          <span
            className={`source-control-commit-ref${ref === currentBranch ? ' is-current' : ''}`}
            key={ref}
            title={ref === currentBranch ? ref : `origin/${ref}`}
          >
            {ref === currentBranch ? ref : `origin/${ref}`}
            <Icon icon="codicon:cloud" aria-hidden="true" />
          </span>
        ))}
      </a>
      {tooltip &&
        createPortal(
          <div
            className="source-control-commit-tooltip"
            id={tooltipId}
            role="tooltip"
            style={{ top: tooltip.top, left: tooltip.left }}
            onMouseLeave={(event) => {
              if (!(
                event.relatedTarget instanceof Node &&
                triggerRef.current?.contains(event.relatedTarget)
              )) {
                setTooltip(null);
              }
            }}
          >
            <div className="source-control-commit-tooltip-heading">
              <strong>{commit.author}</strong>
              <span>
                {formatCommitAge(commit.date)} ({formatCommitDate(commit.date)})
              </span>
            </div>
            <strong className="source-control-commit-tooltip-message">
              {label}
            </strong>
            {commit.message
              .split('\n')
              .slice(1)
              .filter(Boolean)
              .map((line, index) => (
                <p key={`${index}-${line}`}>{line}</p>
              ))}
            <div
              className="source-control-commit-tooltip-stats"
              aria-live="polite"
            >
              {details ? (
                <>
                  <span>
                    {details.filesChanged}{' '}
                    {details.filesChanged === 1 ? 'file' : 'files'} changed,
                  </span>
                  <span className="is-insertions">
                    {details.insertions.toLocaleString()} insertions(+),
                  </span>
                  <span className="is-deletions">
                    {details.deletions.toLocaleString()} deletions(-)
                  </span>
                </>
              ) : detailsState === 'failed' ? (
                <span>Change summary unavailable.</span>
              ) : (
                <span>
                  {detailsState === 'loading'
                    ? 'Loading change summary…'
                    : `${branch} · Loading change summary…`}
                </span>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function formatCommitDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Unknown date';
}

