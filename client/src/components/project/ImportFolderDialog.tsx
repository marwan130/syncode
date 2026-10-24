import type { MouseEvent, ReactNode } from 'react';
import type { ImportedFileContent } from '../../import/folderImport';
import { useFolderImport } from '../../hooks/useFolderImport';
import { ImportFolderFileList } from './ImportFolderFileList';

export interface ImportFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (files: ImportedFileContent[]) => Promise<void>;
}

export function ImportFolderDialog({
  isOpen,
  onClose,
  onImport,
}: ImportFolderDialogProps) {
  const {
    inputRef,
    candidates,
    skipped,
    error,
    isReading,
    isImporting,
    selectedCount,
    selectedBytes,
    canImport,
    selectFolder,
    handleInputChange,
    toggleCandidate,
    importSelected,
  } = useFolderImport({ onImport, onClose });

  if (!isOpen) return null;

  return (
    <ImportFolderDialogSurface
      onClose={onClose}
      isImporting={isImporting}
      content={
        <ImportFolderDialogContent
          inputRef={inputRef}
          candidates={candidates}
          skipped={skipped}
          error={error}
          isReading={isReading}
          isImporting={isImporting}
          selectedCount={selectedCount}
          selectedBytes={selectedBytes}
          canImport={canImport}
          selectFolder={selectFolder}
          handleInputChange={handleInputChange}
          toggleCandidate={toggleCandidate}
          importSelected={importSelected}
          onClose={onClose}
        />
      }
    />
  );
}

interface ImportFolderDialogContentProps {
  inputRef: ReturnType<typeof useFolderImport>['inputRef'];
  candidates: ReturnType<typeof useFolderImport>['candidates'];
  skipped: ReturnType<typeof useFolderImport>['skipped'];
  error: string;
  isReading: boolean;
  isImporting: boolean;
  selectedCount: number;
  selectedBytes: number;
  canImport: boolean;
  selectFolder: () => Promise<void>;
  handleInputChange: ReturnType<typeof useFolderImport>['handleInputChange'];
  toggleCandidate: ReturnType<typeof useFolderImport>['toggleCandidate'];
  importSelected: () => Promise<void>;
  onClose: () => void;
}

function ImportFolderDialogSurface({
  onClose,
  isImporting,
  content,
}: {
  onClose: () => void;
  isImporting: boolean;
  content: ReactNode;
}) {
  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onMouseDown={(event) => closeOnBackdrop(event, isImporting, onClose)}
    >
      <section
        className="project-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
      >
        {content}
      </section>
    </div>
  );
}

function closeOnBackdrop(
  event: MouseEvent<HTMLDivElement>,
  isImporting: boolean,
  onClose: () => void
): void {
  if (event.target === event.currentTarget && !isImporting) onClose();
}

function ImportFolderDialogContent(props: ImportFolderDialogContentProps) {
  return (
    <>
      <h2 id="project-import-title">Import folder</h2>
      <p className="project-import-warning">
        Everyone in this room will see the imported files, and the server will
        relay them to room participants. Review the list before importing.
      </p>
      <FolderPicker {...props} />
      <FolderImportSummary {...props} />
      <FolderImportError error={props.error} />
      <FolderImportActions {...props} />
    </>
  );
}

function FolderPicker({
  inputRef,
  handleInputChange,
  selectFolder,
  isReading,
  isImporting,
}: ImportFolderDialogContentProps) {
  return (
    <>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        multiple
        onChange={handleInputChange}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <button
        className="project-action-button project-import-select"
        type="button"
        onClick={() => void selectFolder()}
        disabled={isReading || isImporting}
      >
        {isReading ? 'Reading folder…' : 'Choose folder'}
      </button>
    </>
  );
}

function FolderImportSummary({
  candidates,
  skipped,
  selectedCount,
  selectedBytes,
  toggleCandidate,
  isImporting,
}: ImportFolderDialogContentProps) {
  if (candidates.length === 0 && skipped.length === 0) return null;
  return (
    <>
      <div className="project-import-summary">
        {selectedCount} selected · {(selectedBytes / 1024).toFixed(1)} KB of 1 MB · 64 KB max per file ·{' '}
        {skipped.length} skipped
      </div>
      <ImportFolderFileList
        candidates={candidates}
        skipped={skipped}
        onToggle={toggleCandidate}
        disabled={isImporting}
      />
    </>
  );
}

function FolderImportError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p className="project-import-error" role="alert">
      {error}
    </p>
  );
}

function FolderImportActions({
  onClose,
  isImporting,
  canImport,
  importSelected,
}: ImportFolderDialogContentProps) {
  return (
    <div className="project-import-actions">
      <button
        className="project-action-button"
        type="button"
        onClick={onClose}
        disabled={isImporting}
      >
        Cancel
      </button>
      <button
        className="project-action-button"
        type="button"
        onClick={() => void importSelected()}
        disabled={!canImport}
      >
        {isImporting ? 'Importing…' : 'Import selected'}
      </button>
    </div>
  );
}
