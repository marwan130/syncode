import type { ImportFileCandidate } from '../../import/folderImport';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

export interface ImportFolderFileListProps {
  candidates: ImportFileCandidate[];
  skipped: Array<{ path: string; reason: string }>;
  onToggle: (path: string, selected: boolean) => void;
  disabled: boolean;
}

export function ImportFolderFileList({
  candidates,
  skipped,
  onToggle,
  disabled,
}: ImportFolderFileListProps) {
  return (
    <ScrollbarPanel
      className="project-import-list"
      aria-label="Files to import"
    >
      {candidates.map((candidate) => (
        <label className="project-import-row" key={candidate.path}>
          <input
            type="checkbox"
            checked={candidate.selected}
            onChange={(event) =>
              onToggle(candidate.path, event.currentTarget.checked)
            }
            disabled={disabled}
          />
          <span className="project-import-path" title={candidate.path}>
            {candidate.path}
          </span>
          <span className="project-import-size">
            {(candidate.size / 1024).toFixed(1)} KB
          </span>
        </label>
      ))}
      {skipped.map((item) => (
        <div className="project-import-row is-skipped" key={item.path}>
          <span className="project-import-skipped-label">Skipped</span>
          <span className="project-import-path" title={item.path}>
            {item.path}
          </span>
          <span className="project-import-skip-reason">{item.reason}</span>
        </div>
      ))}
    </ScrollbarPanel>
  );
}
