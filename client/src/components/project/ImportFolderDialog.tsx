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
    <div
      className="project-import-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isImporting) onClose();
      }}
    >
      <section
        className="project-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
      >
        <h2 id="project-import-title">Import folder</h2>
        <p className="project-import-warning">
          Everyone in this room will see the imported files, and the server will
          relay them to room participants. Review the list before importing.
        </p>

        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          onChange={handleInputChange}
          {...({ webkitdirectory: '', directory: '' } as Record<
            string,
            string
          >)}
        />
        <button
          className="project-import-select"
          type="button"
          onClick={() => void selectFolder()}
          disabled={isReading || isImporting}
        >
          {isReading ? 'Reading folder…' : 'Choose folder'}
        </button>

        {(candidates.length > 0 || skipped.length > 0) && (
          <>
            <div className="project-import-summary">
              {selectedCount} selected · {(selectedBytes / 1024).toFixed(1)} KB
              {' · '}
              {skipped.length} skipped
            </div>
            <ImportFolderFileList
              candidates={candidates}
              skipped={skipped}
              onToggle={toggleCandidate}
              disabled={isImporting}
            />
          </>
        )}

        {error && (
          <p className="project-import-error" role="alert">
            {error}
          </p>
        )}

        <div className="project-import-actions">
          <button type="button" onClick={onClose} disabled={isImporting}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void importSelected()}
            disabled={!canImport}
          >
            {isImporting ? 'Importing…' : 'Import selected'}
          </button>
        </div>
      </section>
    </div>
  );
}
