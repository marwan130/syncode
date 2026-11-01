import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorWelcomePane } from '../EditorWelcomePane';
import { EmptyEditorPane } from '../EmptyEditorPane';
import { SplitEditorPane } from '../SplitEditorPane';

describe('EditorWelcomePane', () => {
  it('renders Syncode welcome branding and start actions', () => {
    const markup = renderToStaticMarkup(
      createElement(EditorWelcomePane, {
        welcome: {
          canEdit: true,
          canImport: true,
          onNewFile: () => undefined,
          onOpenFileLocal: () => undefined,
          onOpenFolderLocal: () => undefined,
          onOpenGithub: () => undefined,
        },
      })
    );

    expect(markup).toContain('Syncode');
    expect(markup).not.toContain('>Start<');
    expect(markup).toContain('New File');
    expect(markup).toContain('Open File');
    expect(markup).toContain('Open Folder');
    expect(markup).toContain('Open GitHub Repository');

    // Ensure removed elements are not present
    expect(markup).not.toContain('Open Files');
    expect(markup).not.toContain('Help');
    expect(markup).not.toContain('HELP');
  });

  it('disables GitHub repository access for non-admins', () => {
    const markup = renderToStaticMarkup(
      createElement(EditorWelcomePane, {
        welcome: {
          canEdit: true,
          canImport: false,
          onNewFile: () => undefined,
          onOpenFileLocal: () => undefined,
          onOpenFolderLocal: () => undefined,
          onOpenGithub: () => undefined,
        },
      })
    );

    expect(markup).toContain(
      '<button type="button" class="editor-welcome-action-trigger" disabled="">'
    );
    expect(markup).toContain('Open GitHub Repository');
  });

  it('renders welcome pane for primary group and split pane for secondary group', () => {
    const primaryMarkup = renderToStaticMarkup(
      createElement(EmptyEditorPane, {
        entries: [],
        group: 'group-1',
        onOpenFile: () => undefined,
      })
    );
    expect(primaryMarkup).toContain('Syncode');
    expect(primaryMarkup).not.toContain(
      'This workspace is empty. Create a file in the Explorer to start editing.'
    );

    const splitMarkup = renderToStaticMarkup(
      createElement(EmptyEditorPane, {
        entries: [],
        group: 'group-2',
        onOpenFile: () => undefined,
      })
    );
    expect(splitMarkup).not.toContain('Syncode');
    expect(splitMarkup).toContain(
      'This workspace is empty. Create a file in the Explorer to start editing.'
    );
  });

  it('makes the centered empty editor area open the file picker', () => {
    const markup = renderToStaticMarkup(
      createElement(SplitEditorPane, {
        entries: [
          { id: 'file-1', name: 'main.ts', parentId: null, isFolder: false },
        ],
        group: 'group-2',
        onOpenFile: () => undefined,
      })
    );

    expect(markup).toContain('role="button"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('class="editor-drop-placeholder"');
    expect(markup).toContain('Select a file to start editing.');
  });
});
