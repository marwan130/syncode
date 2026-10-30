import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { getFileIcon } from '../editor/fileExplorerUtils';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { userFacingError } from '../../utils/userFacingError';
import { projectFileListViewportHeight } from './projectFileListLayout';

export interface ProjectFileSelectionItem {
  path: string;
  size: number;
}

export interface ProjectSkippedFile {
  path: string;
  reason: string;
}

export interface ProjectFileSelectionAction {
  id: string;
  label: (count: number, allSelected: boolean) => string;
  progressLabel: string;
  primary?: boolean;
  cancellable?: boolean;
  progressiveCompletion?: boolean;
  cancelledMessage?: string;
  closeOnCancel?: boolean;
  disabled?: boolean;
  onSelect: (
    paths: string[],
    onProgress: (completedFiles: number) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

export function ProjectFileSelectionDialog({
  title,
  description,
  summary,
  warning,
  files,
  skipped = [],
  maxSelectionBytes,
  actions,
  showHeaderClose = false,
  onClose,
}: {
  title: string;
  description: string;
  summary: string;
  warning?: string;
  files: ProjectFileSelectionItem[];
  skipped?: ProjectSkippedFile[];
  maxSelectionBytes?: number;
  actions: ProjectFileSelectionAction[];
  showHeaderClose?: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(files.map((file) => file.path))
  );
  const [processedPaths, setProcessedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [processingPaths, setProcessingPaths] = useState<string[]>([]);
  const [processingActionId, setProcessingActionId] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isBusy, onClose]);

  const pendingFiles = useMemo(
    () => files.filter((file) => !processedPaths.has(file.path)),
    [files, processedPaths]
  );
  const selectedFiles = pendingFiles.filter((file) =>
    selectedPaths.has(file.path)
  );
  const selectedBytes = selectedFiles.reduce(
    (total, file) => total + file.size,
    0
  );
  const allSelected =
    pendingFiles.length > 0 && selectedFiles.length === pendingFiles.length;
  const exceedsSelectionLimit =
    maxSelectionBytes !== undefined && selectedBytes > maxSelectionBytes;
  const activeAction = actions.find(
    (action) => action.id === processingActionId
  );

  const toggleAll = () => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const file of pendingFiles) {
        if (allSelected) next.delete(file.path);
        else next.add(file.path);
      }
      return next;
    });
  };

  const runAction = async (action: ProjectFileSelectionAction) => {
    const paths = selectedFiles.map((file) => file.path);
    if (!paths.length || action.disabled || isBusy) return;
    setBusy(true);
    setError('');
    setStatusMessage('');
    setProcessingActionId(action.id);
    setProcessingPaths(paths);
    setCompletedCount(0);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let closeAfterCancel = false;
    try {
      await action.onSelect(
        paths,
        (count) => {
          const boundedCount = Math.max(0, Math.min(paths.length, count));
          setCompletedCount(boundedCount);
          if (action.progressiveCompletion !== false) {
            setProcessedPaths(
              (prev) => new Set([...prev, ...paths.slice(0, boundedCount)])
            );
          }
        },
        controller.signal
      );
      setProcessedPaths((previous) => new Set([...previous, ...paths]));
      onClose();
    } catch (reason) {
      if (
        (reason instanceof DOMException && reason.name === 'AbortError') ||
        (reason instanceof Error && reason.name === 'AbortError') ||
        (reason as { name?: string })?.name === 'AbortError' ||
        controller.signal.aborted
      ) {
        setStatusMessage(
          action.cancelledMessage ??
            'Saving was cancelled. Completed files are saved and the remaining files are still selected.'
        );
        closeAfterCancel = action.closeOnCancel === true;
      } else {
        setError(
          userFacingError(reason, 'Could not complete the file operation.')
        );
      }
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
      setProcessingActionId('');
      setProcessingPaths([]);
      setCompletedCount(0);
      if (closeAfterCancel) onClose();
    }
  };

  const cancelAction = () => {
    if (isBusy) {
      if (activeAction?.cancellable) abortControllerRef.current?.abort();
      return;
    }
    onClose();
  };

  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        className="project-import-dialog github-repository-dialog project-file-selection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {showHeaderClose ? (
          <div className="editor-file-picker-heading">
            <h2 id={titleId}>{title}</h2>
            <button type="button" disabled={isBusy} onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <h2 id={titleId}>{title}</h2>
        )}
        {description ? <p>{description}</p> : null}
        {summary && <p className="github-repository-summary">{summary}</p>}
        {warning && <p className="project-import-warning">{warning}</p>}
        <div className="project-file-selection-toolbar">
          <label className="project-file-selection-all">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={isBusy || pendingFiles.length === 0}
              onChange={toggleAll}
            />
            Select all
          </label>
          <span className="github-repository-summary" aria-live="polite">
            {isBusy && activeAction
              ? `${activeAction.progressLabel} ${completedCount} of ${processingPaths.length}`
              : `${selectedFiles.length} selected · ${(selectedBytes / 1024).toFixed(1)} KB · ${skipped.length} skipped`}
          </span>
        </div>
        {exceedsSelectionLimit && (
          <p className="project-import-error" role="status">
            The selected files exceed the 1 MB import limit. Deselect some files
            to continue.
          </p>
        )}
        <ScrollbarPanel
          className="project-import-list"
          style={{
            height: projectFileListViewportHeight(
              pendingFiles.length + skipped.length
            ),
            maxHeight: '42vh',
            flex: '0 1 auto',
          }}
          aria-label={`${title} file list`}
        >
          {pendingFiles.map((file) => (
            <label
              className="project-import-row project-file-selection-row"
              key={file.path}
            >
              <input
                type="checkbox"
                checked={selectedPaths.has(file.path)}
                disabled={isBusy}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelectedPaths((current) => {
                    const next = new Set(current);
                    if (checked) next.add(file.path);
                    else next.delete(file.path);
                    return next;
                  });
                  setError('');
                }}
              />
              <FileIcon path={file.path} />
              <span className="project-import-path" title={file.path}>
                {file.path}
              </span>
              <span className="project-import-size">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </label>
          ))}
          {skipped.map((file) => (
            <div
              className="project-import-row project-file-selection-row is-skipped"
              key={file.path}
            >
              <span className="project-import-skipped-label">Skipped</span>
              <FileIcon path={file.path} />
              <span className="project-import-path" title={file.path}>
                {file.path}
              </span>
              <span className="project-import-skip-reason">{file.reason}</span>
            </div>
          ))}
          {files.length === 0 && skipped.length === 0 && (
            <p className="github-repository-empty">No files to show.</p>
          )}
        </ScrollbarPanel>
        {error && (
          <p className="project-import-error" role="alert">
            {error}
          </p>
        )}
        {statusMessage && (
          <p className="github-repository-summary" role="status">
            {statusMessage}
          </p>
        )}
        <footer className="project-import-actions">
          {!showHeaderClose && (
            <button
              className="project-action-button project-file-action-button"
              type="button"
              onClick={cancelAction}
              disabled={isBusy && !activeAction?.cancellable}
            >
              Cancel
            </button>
          )}
          {actions.map((action) => (
            <button
              className={`project-action-button project-file-action-button${action.primary ? ' is-primary' : ''}`}
              key={action.id}
              type="button"
              onClick={() => void runAction(action)}
              disabled={
                isBusy ||
                selectedFiles.length === 0 ||
                action.disabled ||
                exceedsSelectionLimit
              }
            >
              {isBusy && action.id === processingActionId
                ? `${activeAction?.progressLabel ?? 'Processing'} ${completedCount} of ${processingPaths.length}…`
                : action.label(selectedFiles.length, allSelected)}
            </button>
          ))}
        </footer>
      </section>
    </div>
  );
}

function FileIcon({ path }: { path: string }) {
  const name = path.split('/').at(-1) ?? path;
  return (
    <Icon
      className="project-import-file-icon"
      icon={getFileIcon({ name, isFolder: false }, false)}
      aria-hidden="true"
    />
  );
}
