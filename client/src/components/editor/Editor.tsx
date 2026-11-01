import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useAutocompletePreference } from '../../hooks/useAutocompletePreference';
import {
  isPreviewLanguage,
  languageForFileName,
  type LanguageMode,
} from './languageModes';
import { EditorRoomLayout } from './EditorRoomLayout';
import { configureMonacoEditor } from '../../utils/configureMonacoEditor';
import { useEditorRoomSession } from './useEditorRoomSession';
import { useEditorWorkspaceState } from './useEditorWorkspaceState';
import { useEditorPanelState } from './useEditorPanelState';
import { useEditorActivityState } from './useEditorActivityState';
import { useEditorCollaborationState } from './useEditorCollaborationState';
import { useRoomJoinRequests } from '../../hooks/useRoomJoinRequests';
import { useAppFeedback } from '../shared/useAppFeedback';
import { GithubRepositoryDialog } from '../github/GithubRepositoryDialog';
import { SaveProjectFilesDialog } from './SaveProjectFilesDialog';
import type { ImportedFileContent } from '../../import/folderImport';
import type { TerminalRunRequest } from './terminalTypes';
import type { ExecutionLanguage } from '../../providers/SignalRCrdtProvider';
import type { GithubChangeStatus } from '../../github/changeTracker';
import { getEntryPath } from './editorLayoutStorage';
import { useLocalProjectImport } from '../../hooks/useLocalProjectImport';
import { ProjectFileSelectionDialog } from '../project/ProjectFileSelectionDialog';
import { MAX_IMPORT_TOTAL_BYTES } from '../../import/folderImport';

export interface EditorProps {
  roomId?: string;
  accessKey: string;
}

function EditorComponent({ roomId: propRoomId, accessKey }: EditorProps) {
  const {
    roomId,
    identity: roomIdentity,
    account,
    leaveRoom,
    ...connection
  } = useEditorRoomSession(propRoomId, accessKey);
  const { displayName, localColor, participantId, setLocalColor } =
    roomIdentity;
  const [monacoApi, setMonacoApi] = useState<Monaco | null>(null);
  useEffect(
    () => () => {
      monacoApi?.editor
        .getModels()
        .filter(
          (model: monaco.editor.ITextModel) =>
            model.uri.scheme === 'syncode' &&
            model.uri.authority === encodeURIComponent(roomId)
        )
        .forEach((model: monaco.editor.ITextModel) => model.dispose());
    },
    [monacoApi, roomId]
  );
  const [isGithubDialogOpen, setGithubDialogOpen] = useState(false);
  const [isSaveProjectDialogOpen, setSaveProjectDialogOpen] = useState(false);
  const [projectFilesToSave, setProjectFilesToSave] = useState<
    ImportedFileContent[]
  >([]);
  const [githubRepositoryUrl, setGithubRepositoryUrl] = useState('');
  const [createFileNonce, setCreateFileNonce] = useState(0);
  const { showMessage } = useAppFeedback();
  const [autocompleteEnabled, setAutocompleteEnabled] =
    useAutocompletePreference();
  const [monacoEditors, setMonacoEditors] = useState<
    Map<string, monaco.editor.IStandaloneCodeEditor>
  >(() => new Map());
  const { status, connectionError, providerRef } = connection;
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    return provider.onRoomRecoveryFailed(() => {
      setRecoveryError(
        'Workspace recovery failed. Download your offline work to preserve it.'
      );
    });
  }, [providerRef]);
  const workspace = useEditorWorkspaceState(roomId, providerRef, status);
  const panels = useEditorPanelState(workspace);
  const {
    entries,
    projectRootName,
    activeFileId,
    editorGroups,
    activeEditorGroupId,
    openFile,
    closeFileTab,
    splitWorkspace,
    closeEditorGroup,
    resizeEditorGroups,
    setActiveEditorGroup,
    handleDropFile,
    createEntry,
    activeFile,
    activeFilePath,
    explorerActions,
    transfer,
    canSplitWorkspace,
    previewWidth,
    setPreviewWidth,
    isPreviewOpen,
    setPreviewOpen,
  } = workspace;
  const { openReviewTab, updateReviewTabs } = workspace;
  const { importProjectFiles } = transfer;
  const {
    isExplorerOpen,
    setExplorerOpen,
    activeSidebarView,
    setActiveSidebarView,
    explorerWidth,
    setExplorerWidth,
    chatWidth,
    setChatOpen,
    isChatOpen,
    setChatWidth,
    terminalHeight,
    setTerminalHeight,
    isShortcutGuideOpen,
    setShortcutGuideOpen,
    newTerminalRequest,
    terminalPanelMounted,
    isTerminalOpen,
    bottomPanelView,
    setBottomPanelView,
    actions: panelActions,
  } = panels;
  const [terminalRunRequest, setTerminalRunRequest] =
    useState<TerminalRunRequest | null>(null);
  const requestRun = useCallback(
    (runLanguage: ExecutionLanguage, sourcePath: string) => {
      setBottomPanelView('terminal');
      panels.revealTerminalPanel();
      setTerminalRunRequest({
        id: crypto.randomUUID(),
        language: runLanguage,
        sourcePath,
      });
    },
    [panels, setBottomPanelView]
  );
  const monacoEditor = monacoEditors.get(activeEditorGroupId) ?? null;
  const language: LanguageMode = languageForFileName(activeFilePath);
  const activity = useEditorActivityState({
    providerRef,
    status,
    activeFile,
    activeFilePath,
    language,
    monacoEditor,
    monacoApi,
    canSplitWorkspace,
    splitWorkspace,
    panels,
    requestRun,
  });
  const {
    canRunCode,
    runDisabledReason,
    messages,
    sendMessage,
    handleRunCode,
  } = activity;
  const collaboration = useEditorCollaborationState({
    providerRef,
    roomId,
    status,
    displayName,
    localColor,
    workspace,
    editors: monacoEditors,
    monacoApi,
    accessKey,
    setPreviewOpen,
    language,
  });
  const {
    peers,
    localParticipant,
    isEditLocked,
    participantActions,
    githubExplorer,
    previewSource,
    fileDiagnostics,
    problems,
  } = collaboration;
  const canManageRepositories = Boolean(localParticipant?.isAdmin);
  const openGithubRepositoryPicker = (repositoryUrl = '') => {
    if (!canManageRepositories) return;
    setGithubRepositoryUrl(repositoryUrl);
    setGithubDialogOpen(true);
  };
  const fileProblemCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const problem of problems) {
      counts[problem.fileId] = (counts[problem.fileId] ?? 0) + 1;
    }
    return counts;
  }, [problems]);
  const joinRequests = useRoomJoinRequests(
    providerRef,
    status,
    Boolean(localParticipant?.isAdmin)
  );
  const githubBaseline = githubExplorer?.baseline;
  const openGithubChange = useCallback(
    (change: GithubChangeStatus) => {
      const entry = entries.find(
        (candidate) =>
          !candidate.isFolder &&
          getEntryPath(candidate, entries) === change.path
      );
      if (change.kind === 'added') {
        if (entry) openFile(entry.id);
        return;
      }
      if (!githubBaseline) {
        if (entry) openFile(entry.id);
        return;
      }
      openReviewTab({
        id: `source-control:${roomId}:${change.path}`,
        change,
        baseline: githubBaseline,
      });
    },
    [entries, githubBaseline, openFile, openReviewTab, roomId]
  );
  useEffect(() => {
    if (githubExplorer?.baseline)
      updateReviewTabs(githubExplorer.changes, githubExplorer.baseline);
  }, [githubExplorer?.baseline, githubExplorer?.changes, updateReviewTabs]);

  const handleEditorMount = useCallback(
    (
      groupId: string,
      editor: monaco.editor.IStandaloneCodeEditor,
      monacoInstance: Monaco
    ) => {
      configureMonacoEditor(monacoInstance);
      setMonacoEditors((current) => {
        const next = new Map(current);
        next.set(groupId, editor);
        return next;
      });
      setMonacoApi(monacoInstance);
    },
    []
  );
  const handleEditorDispose = useCallback((groupId: string) => {
    setMonacoEditors((current) => {
      if (!current.has(groupId)) return current;
      const next = new Map(current);
      next.delete(groupId);
      return next;
    });
  }, []);
  const openFileAtLine = (fileId: string, line: number) => {
    openFile(fileId);
    window.setTimeout(() => {
      const editor = monacoEditors.get(workspace.activeEditorGroupId);
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    }, 50);
  };
  const {
    openLocalFile,
    openLocalFolder,
    folderPreview,
    importLocalFolder,
    closeFolderPreview,
  } = useLocalProjectImport({
    importProjectFiles,
    setPreviewOpen,
    showMessage,
  });

  return (
    <>
      <EditorRoomLayout
        roomHeader={{
          profile: {
            roomId,
            participantId,
            localName: displayName,
            localColor,
            localAvatarUrl: account?.avatarUrl,
            canLeaveRoom: status === 'connected',
            onJoinProfile: roomIdentity.updateProfile,
            onColorChange: setLocalColor,
            onLeaveRoom: leaveRoom,
          },
          participants: {
            peers,
            isAdmin: Boolean(localParticipant?.isAdmin),
            onToggleParticipantLock: participantActions.toggleEditLock,
            onSetParticipantAdmin: participantActions.setAdminRole,
            onKickParticipant: participantActions.kickParticipant,
            joinRequests: joinRequests.requests,
            onApproveJoinRequest: joinRequests.approve,
            onRejectJoinRequest: joinRequests.reject,
          },
          toolbar: {
            monaco: monacoApi,
            autocompleteEnabled,
            onAutocompleteChange: setAutocompleteEnabled,
            showPreviewButton: isPreviewLanguage(language),
            onShowPreview: panelActions.togglePreview,
          },
        }}
        connectionError={recoveryError ?? connectionError}
        onSaveProject={async () => {
          setProjectFilesToSave(transfer.getCurrentProjectFiles());
          setSaveProjectDialogOpen(true);
        }}
        fileExplorer={{
          isOpen: isExplorerOpen,
          width: explorerWidth,
          entries,
          projectRootName,
          activeFileId,
          canEdit:
            !isEditLocked &&
            status !== 'awaiting-approval' &&
            status !== 'join-rejected',
          fileDiagnostics,
          fileProblemCounts,
          createFileNonce,
          onWidthChange: setExplorerWidth,
          onClose: () => setExplorerOpen(false),
          actions: {
            onSelect: openFile,
            onCreateEntry: createEntry,
            onRename: explorerActions.renameEntry,
            onDelete: explorerActions.deleteEntry,
            onMove: explorerActions.moveEntry,
          },
          projectActions: {
            canImportFolder: canManageRepositories,
            onImportFolder: openLocalFolder,
            onOpenFile: openLocalFile,
            onOpenGithub: () => setActiveSidebarView('source-control'),
            onSaveProject: async () => {
              setProjectFilesToSave(transfer.getCurrentProjectFiles());
              setSaveProjectDialogOpen(true);
            },
            github: githubExplorer,
          },
        }}
        chat={{
          isOpen: isChatOpen,
          width: chatWidth,
          messages,
          status,
          onWidthChange: setChatWidth,
          onClose: () => setChatOpen(false),
          onSendMessage: sendMessage,
        }}
        workspace={{
          entries,
          reviewTabs: workspace.reviewTabs,
          sourceControlChanges: githubExplorer?.changes,
          canSplitWorkspace,
          hasLivePreview: isPreviewLanguage(language),
          fileDiagnostics,
          fileProblemCounts,
          editorGroups,
          activeEditorGroupId,
          status,
          isLocked: isEditLocked,
          autocompleteEnabled,
          peers,
          providerRef,
          onMountGroup: handleEditorMount,
          onDisposeGroup: handleEditorDispose,
          onOpenFile: openFile,
          onOpenReviewTab: workspace.openReviewTab,
          onCloseFileTab: closeFileTab,
          onSplitWorkspace: splitWorkspace,
          onCloseEditorGroup: closeEditorGroup,
          onResizeEditorGroups: resizeEditorGroups,
          onSetActiveGroup: setActiveEditorGroup,
          onDropFile: handleDropFile,
          welcome: {
            canEdit:
              !isEditLocked &&
              status !== 'awaiting-approval' &&
              status !== 'join-rejected',
            canImport: canManageRepositories,
            onNewFile: () => {
              setActiveSidebarView('explorer');
              setCreateFileNonce((value) => value + 1);
            },
            onOpenFileLocal: openLocalFile,
            onOpenFolderLocal: openLocalFolder,
            onOpenGithub: openGithubRepositoryPicker,
          },
        }}
        preview={{
          isOpen: isPreviewOpen,
          width: previewWidth,
          hasActiveFile: Boolean(activeFile),
          language,
          project: previewSource,
          monaco: monacoApi,
          editor: monacoEditor,
          onWidthChange: setPreviewWidth,
          onClose: () => setPreviewOpen(false),
        }}
        terminal={{
          isOpen: isTerminalOpen,
          hasOpened: terminalPanelMounted,
          height: terminalHeight,
          providerRef,
          status,
          newTerminalRequest,
          onHeightChange: setTerminalHeight,
          onClose: panelActions.closeTerminal,
          onEmpty: panelActions.closeTerminal,
          activeView: bottomPanelView,
          onSelectView: setBottomPanelView,
          runRequest: terminalRunRequest,
          onRunRequestClaimed: (requestId: string) =>
            setTerminalRunRequest((current) =>
              current?.id === requestId ? null : current
            ),
          onRun: handleRunCode,
          canRun: canRunCode,
          runDisabledReason,
          problems,
          onOpenProblem: openFileAtLine,
        }}
        isShortcutGuideOpen={isShortcutGuideOpen}
        setShortcutGuideOpen={setShortcutGuideOpen}
        activeSidebarView={activeSidebarView}
        onSelectSidebarView={(view) =>
          setActiveSidebarView((current) => (current === view ? null : view))
        }
        onCloseSidebarView={() => setActiveSidebarView(null)}
        sidebarWidth={explorerWidth}
        onSidebarWidthChange={setExplorerWidth}
        onToggleChat={panelActions.toggleChat}
        problems={problems}
        onOpenProblems={() => {
          setBottomPanelView('problems');
          panels.revealTerminalPanel();
        }}
        activity={{
          entries,
          activeFileId,
          providerRef,
          github: githubExplorer,
          canManageRepositories,
          canRunCode,
          runDisabledReason,
          onOpenFile: openFileAtLine,
          onRunCode: handleRunCode,
          onOpenTerminal: panelActions.openTerminal,
          onOpenGithub: openGithubRepositoryPicker,
          onOpenChange: openGithubChange,
        }}
      />
      {githubExplorer && (
        <GithubRepositoryDialog
          isOpen={isGithubDialogOpen}
          roomId={githubExplorer.roomId}
          accessKey={githubExplorer.accessKey}
          baseline={githubExplorer.baseline}
          changes={githubExplorer.changes}
          canImport={githubExplorer.canImport && !isEditLocked}
          onRequestAdminGrant={githubExplorer.onRequestAdminGrant}
          onClose={() => setGithubDialogOpen(false)}
          onImport={githubExplorer.onImport}
          onBaselineChange={githubExplorer.onBaselineChange}
          forceRepositoryPicker
          initialRepositoryUrl={githubRepositoryUrl}
        />
      )}
      {isSaveProjectDialogOpen && (
        <SaveProjectFilesDialog
          files={projectFilesToSave}
          projectName={projectRootName}
          onClose={() => setSaveProjectDialogOpen(false)}
        />
      )}
      {folderPreview && (
        <ProjectFileSelectionDialog
          title="Import local folder"
          description="The total import limit is 1 MB."
          summary={`${folderPreview.folderName ?? 'Selected folder'} · ${folderPreview.candidates.length} available files`}
          warning="The current room project will be replaced. Everyone in this room will see the imported files."
          files={folderPreview.candidates.map(({ path, size }) => ({
            path,
            size,
          }))}
          skipped={folderPreview.skipped}
          maxSelectionBytes={MAX_IMPORT_TOTAL_BYTES}
          showHeaderClose
          onClose={closeFolderPreview}
          actions={[
            {
              id: 'import',
              label: (count, allSelected) =>
                `${allSelected ? 'Import all' : 'Import selected'} (${count})`,
              progressLabel: 'Importing',
              primary: true,
              progressiveCompletion: false,
              onSelect: importLocalFolder,
            },
          ]}
        />
      )}
    </>
  );
}

export default EditorComponent;
