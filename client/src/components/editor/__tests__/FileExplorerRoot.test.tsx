import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FileExplorerRoot } from '../FileExplorerRoot';
import type { ExplorerNodeSharedProps } from '../fileExplorerTypes';
import type { RoomEntry } from '../../../providers/SignalRCrdtProvider';

const mockTreeProps: ExplorerNodeSharedProps = {
  entries: [],
  childrenByParent: new Map(),
  selectedEntryId: null,
  canEdit: true,
  expandedFolders: new Set(),
  diagnosticsByEntry: {},
  gitStatusByEntry: new Map(),
  editing: null,
  draftName: '',
  editError: '',
  renderNameInput: () => null,
  onToggleFolder: () => undefined,
  onContextMenuSelect: () => undefined,
  onStartCreate: () => undefined,
  onStartRename: () => undefined,
  onDelete: () => undefined,
  onSelect: () => undefined,
  onMove: () => Promise.resolve(),
};

describe('FileExplorerRoot', () => {
  it('renders vscode.dev empty state with NO FOLDER OPENED when empty', () => {
    const markup = renderToStaticMarkup(
      createElement(FileExplorerRoot, {
        tree: mockTreeProps,
        entries: [],
        selectedEntryId: null,
        isRootExpanded: true,
        canImportFolder: true,
        onImportFolder: () => undefined,
        onOpenFile: () => undefined,
        onOpenGithub: () => undefined,
        onToggleRoot: () => undefined,
        onDragOver: () => undefined,
        onDrop: () => undefined,
      })
    );

    // Verify vscode.dev empty layout
    expect(markup).toContain('EXPLORER');
    expect(markup).toContain('NO FOLDER OPENED');
    expect(markup).toContain('You have not yet opened a folder.');
    expect(markup).toContain('Open Folder');
    expect(markup).toContain('Open File');
    expect(markup).toContain('Open Remote Repository');
    expect(markup).toContain('>New File</button>');
    expect(markup.indexOf('>Open File</button>')).toBeLessThan(
      markup.indexOf('>New File</button>')
    );
    expect(markup.indexOf('>New File</button>')).toBeLessThan(
      markup.indexOf('Open Remote Repository')
    );
    // Ensure removed / forbidden elements
    expect(markup).not.toContain('OUTLINE');
    expect(markup).not.toContain('TIMELINE');
    expect(markup).not.toContain('SYNCODE');
    expect(markup.toLowerCase()).not.toContain('tunnel');
  });

  it('does not offer project imports to non-admins', () => {
    const markup = renderToStaticMarkup(
      createElement(FileExplorerRoot, {
        tree: { ...mockTreeProps, canEdit: false },
        entries: [],
        selectedEntryId: null,
        isRootExpanded: true,
        canImportFolder: false,
        onImportFolder: () => undefined,
        onOpenFile: () => undefined,
        onOpenGithub: () => undefined,
        onToggleRoot: () => undefined,
        onDragOver: () => undefined,
        onDrop: () => undefined,
      })
    );

    expect(markup).not.toContain('Open Folder');
    expect(markup).not.toContain('Open File');
    expect(markup).toContain('New File');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('disabled="">Open Remote Repository</button>');
  });

  it('explains that only admins can open a GitHub repository', () => {
    const markup = renderToStaticMarkup(
      createElement(FileExplorerRoot, {
        tree: mockTreeProps,
        entries: [],
        selectedEntryId: null,
        isRootExpanded: true,
        canImportFolder: false,
        onOpenGithub: () => undefined,
        workspaceName: 'workspace',
        onToggleRoot: () => undefined,
        onDragOver: () => undefined,
        onDrop: () => undefined,
      })
    );

    expect(markup).toContain(
      'title="Only room admins can open a GitHub repository"'
    );
    expect(markup).toContain(
      'aria-label="Only room admins can open a GitHub repository"'
    );
  });

  it('keeps the imported project name visible after every file is deleted', () => {
    const markup = renderToStaticMarkup(
      createElement(FileExplorerRoot, {
        tree: mockTreeProps,
        entries: [],
        selectedEntryId: null,
        isRootExpanded: true,
        canImportFolder: false,
        workspaceName: 'halqaPay',
        onToggleRoot: () => undefined,
        onDragOver: () => undefined,
        onDrop: () => undefined,
      })
    );

    expect(markup).toContain('halqaPay');
    expect(markup).toContain('This folder is empty.');
    expect(markup).not.toContain('NO FOLDER OPENED');
  });

  it('renders workspace files directly without a fake syncode folder when files exist', () => {
    const testEntries: RoomEntry[] = [
      { id: '1', name: 'app.tsx', parentId: null, isFolder: false },
    ];
    const treePropsWithEntries: ExplorerNodeSharedProps = {
      ...mockTreeProps,
      entries: testEntries,
      childrenByParent: new Map([[null, testEntries]]),
    };

    const markup = renderToStaticMarkup(
      createElement(FileExplorerRoot, {
        tree: treePropsWithEntries,
        entries: testEntries,
        selectedEntryId: null,
        isRootExpanded: true,
        canImportFolder: true,
        workspaceName: 'MY-PROJECT',
        onToggleRoot: () => undefined,
        onDragOver: () => undefined,
        onDrop: () => undefined,
      })
    );

    expect(markup).toContain('EXPLORER');
    expect(markup).toContain('MY-PROJECT');
    expect(markup).toContain('app.tsx');
    expect(markup).toContain('New File...');
    expect(markup).toContain('New Folder...');
    expect(markup).not.toContain('OUTLINE');
    expect(markup).not.toContain('TIMELINE');
    expect(markup).not.toContain('Collapse Folders in Explorer');
    expect(markup).not.toContain('Views and More Actions...');
    expect(markup).not.toContain('Open GitHub repository');

    // Ensure no fake syncode root folder
    expect(markup).not.toContain('file-explorer-root-row');
    expect(markup.toLowerCase()).not.toContain('tunnel');
  });
});
