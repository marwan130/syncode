import type { ImportedFileContent } from '../../import/folderImport';
import { saveProjectFilesToFolder } from '../../import/folderImport';
import { downloadProjectZip } from '../../import/projectExport';
import { useAppActivity } from '../shared/useAppActivity';
import { ProjectFileSelectionDialog } from '../project/ProjectFileSelectionDialog';

export interface SaveProjectFilesDialogProps {
  files: ImportedFileContent[];
  projectName: string;
  onClose: () => void;
}

export function SaveProjectFilesDialog({
  files,
  projectName,
  onClose,
}: SaveProjectFilesDialogProps) {
  const { runActivity } = useAppActivity();
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const selectionFiles = files.map((file) => ({
    path: file.path,
    size: new Blob([file.content]).size,
  }));

  return (
    <ProjectFileSelectionDialog
      title="Save project files"
      description="Choose which workspace files to save."
      summary={`${projectName} · ${files.length} files`}
      files={selectionFiles}
      onClose={onClose}
      actions={[
        {
          id: 'folder',
          label: (count, allSelected) =>
            allSelected
              ? `Save all to folder (${count})`
              : `Save to folder (${count})`,
          progressLabel: 'Saving',
          cancellable: true,
          onSelect: async (paths, onProgress, signal) => {
            const selected = paths.flatMap((path) => {
              const file = fileByPath.get(path);
              return file ? [file] : [];
            });
            const saved = await runActivity('Saving project files…', () =>
              saveProjectFilesToFolder(selected, onProgress, signal)
            );
            if (!saved)
              throw new Error(
                'Saving to a folder is unavailable in this browser. Choose ZIP instead.'
              );
          },
        },
        {
          id: 'zip',
          label: (count, allSelected) =>
            allSelected
              ? `Save all as ZIP (${count})`
              : `Save as ZIP (${count})`,
          progressLabel: 'Preparing ZIP',
          primary: true,
          onSelect: async (paths) => {
            const selected = paths.flatMap((path) => {
              const file = fileByPath.get(path);
              return file ? [file] : [];
            });
            await runActivity('Preparing project ZIP…', async () => {
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, 0)
              );
              downloadProjectZip(selected, projectName);
            });
          },
        },
      ]}
    />
  );
}
