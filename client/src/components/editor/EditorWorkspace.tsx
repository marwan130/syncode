import { useRef } from 'react';
import type { DragEvent, FC, RefObject } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { Cursors } from './Cursors';
import { EditorTabs } from './EditorTabs';
import { ResizeHandle } from './ResizeHandle';
import { languageForFileName, type LanguageMode } from './languageModes';
import { configureMonacoDiagnostics } from '../../utils/monacoDiagnostics';
import type {
  AwarenessState,
  ConnectionStatus,
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';

interface EditorWorkspaceProps {
  entries: RoomEntry[];
  activeFileId: string;
  activeFile?: RoomEntry;
  activeFilePath: string;
  openFileIds: string[];
  splitFileId: string | null;
  splitFile?: RoomEntry;
  splitFilePath: string;
  isSplitWorkspaceOpen: boolean;
  splitWidth: number;
  status: ConnectionStatus;
  language: LanguageMode;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  monacoEditor: monaco.editor.IStandaloneCodeEditor | null;
  onMountPrimary: OnMount;
  onMountSecondary: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  onOpenFile: (fileId: string, group?: 'primary' | 'secondary') => void;
  onCloseFileTab: (fileId: string) => void;
  onSplitWorkspace: () => void;
  onCloseSplitGroup: () => void;
  onSplitWidthChange: (updater: (current: number) => number) => void;
  onSetActiveGroup: (group: 'primary' | 'secondary') => void;
  onDropFile: (fileId: string, group: 'primary' | 'secondary') => void;
  fileDiagnostics?: Record<string, 'error' | 'warning'>;
}

export const EditorWorkspace: FC<EditorWorkspaceProps> = ({
  entries,
  activeFileId,
  activeFile,
  activeFilePath,
  openFileIds,
  splitFileId,
  splitFile,
  splitFilePath,
  isSplitWorkspaceOpen,
  splitWidth,
  status,
  language,
  peers,
  providerRef,
  monacoEditor,
  onMountPrimary,
  onMountSecondary,
  onOpenFile,
  onCloseFileTab,
  onSplitWorkspace,
  onCloseSplitGroup,
  onSplitWidthChange,
  onSetActiveGroup,
  onDropFile,
  fileDiagnostics,
}) => {
  const editorGroupsRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-syncode-file-id')) {
      event.preventDefault();
    }
  };

  const handleDrop = (
    event: DragEvent<HTMLDivElement>,
    group: 'primary' | 'secondary'
  ) => {
    const fileId = event.dataTransfer.getData('application/x-syncode-file-id');
    if (
      !fileId ||
      !entries.some((entry) => entry.id === fileId && !entry.isFolder)
    )
      return;
    event.preventDefault();
    onDropFile(fileId, group);
  };

  return (
    <div className="editor-region">
      <div className="editor-workspace" ref={editorGroupsRef}>
        <div
          className="editor-pane"
          style={
            isSplitWorkspaceOpen
              ? { flexBasis: `${100 - splitWidth}%` }
              : undefined
          }
          onFocusCapture={() => onSetActiveGroup('primary')}
          onDragOver={handleDragOver}
          onDrop={(event) => handleDrop(event, 'primary')}
        >
          <EditorTabs
            group="primary"
            entries={entries}
            fileIds={openFileIds}
            selectedFileId={activeFileId}
            fileDiagnostics={fileDiagnostics}
            onSelectFile={(id) => onOpenFile(id, 'primary')}
            onCloseFile={onCloseFileTab}
            onSplitWorkspace={onSplitWorkspace}
          />
          {activeFile ? (
            <div className="room-code-editor">
              <Editor
                height="100%"
                language={language}
                path={activeFilePath}
                defaultValue=""
                theme="syncode-current-theme"
                beforeMount={configureMonacoDiagnostics}
                onMount={onMountPrimary}
                options={{
                  automaticLayout: true,
                  fontSize: 14,
                  minimap: { enabled: true },
                  readOnly: status !== 'connected',
                  renderValidationDecorations: 'on',
                  glyphMargin: true,
                  lightbulb: { enabled: 'on' as any },
                  quickSuggestions: true,
                  fixedOverflowWidgets: true,
                }}
              />
              {monacoEditor && (
                <Cursors
                  editor={monacoEditor}
                  peers={peers}
                  providerRef={providerRef}
                  status={status}
                  fileId={activeFileId}
                />
              )}
            </div>
          ) : (
            <div className="editor-drop-placeholder">
              Select a file to start editing.
            </div>
          )}
        </div>

        {isSplitWorkspaceOpen && (
          <>
            <ResizeHandle
              label="Resize editor groups"
              onResize={(delta) => {
                const width =
                  editorGroupsRef.current?.getBoundingClientRect().width ?? 0;
                if (width > 0) {
                  onSplitWidthChange((ratio) =>
                    Math.max(25, Math.min(75, ratio + (delta / width) * 100))
                  );
                }
              }}
            />
            <div
              className="editor-pane split-editor-pane"
              style={{ flexBasis: `${splitWidth}%` }}
              onFocusCapture={() => onSetActiveGroup('secondary')}
              onDragOver={handleDragOver}
              onDrop={(event) => handleDrop(event, 'secondary')}
            >
              <EditorTabs
                group="secondary"
                entries={entries}
                fileIds={splitFileId ? [splitFileId] : []}
                selectedFileId={splitFileId}
                fileDiagnostics={fileDiagnostics}
                onSelectFile={(id) => onOpenFile(id, 'secondary')}
                onCloseFile={onCloseFileTab}
                onCloseGroup={onCloseSplitGroup}
              />
              {splitFile ? (
                <div className="room-code-editor split-code-editor">
                  <Editor
                    height="100%"
                    language={languageForFileName(splitFilePath)}
                    path={splitFilePath}
                    defaultValue=""
                    theme="syncode-current-theme"
                    beforeMount={configureMonacoDiagnostics}
                    onMount={onMountSecondary}
                    options={{
                      automaticLayout: true,
                      fontSize: 14,
                      minimap: { enabled: false },
                      readOnly: status !== 'connected',
                      renderValidationDecorations: 'on',
                      glyphMargin: true,
                      lightbulb: { enabled: 'on' as any },
                      quickSuggestions: true,
                      fixedOverflowWidgets: true,
                    }}
                  />
                </div>
              ) : (
                <div className="editor-drop-placeholder">
                  Select a file to start editing.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
