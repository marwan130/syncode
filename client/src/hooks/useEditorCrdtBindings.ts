import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { MonacoCrdtBinding } from '../bindings/MonacoCrdtBinding';
import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';
import type { CursorAnchor } from '../crdt/CursorAnchor';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import { languageForFileName } from '../components/editor/languageModes';

export interface UseEditorCrdtBindingsOptions {
  monacoApi: Monaco | null;
  entries: RoomEntry[];
  openFileIds: string[];
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  primaryEditor: monaco.editor.IStandaloneCodeEditor | null;
  secondaryEditor: monaco.editor.IStandaloneCodeEditor | null;
  activeFileId: string;
  splitFileId: string | null;
  broadcastCursor: (cursor: CursorAnchor | null) => void;
}

function createMissingEditorModels(
  monacoApi: Monaco,
  entries: RoomEntry[],
  openFileIds: string[],
  provider: SignalRCrdtProvider
): void {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const fileId of openFileIds) {
    const entry = entriesById.get(fileId);
    if (!entry || entry.isFolder) continue;
    const filePath = getEntryPath(entry, entries);
    const uri = monacoApi.Uri.parse(filePath);
    if (monacoApi.editor.getModel(uri)) continue;
    monacoApi.editor.createModel(
      provider.getFileContent(fileId),
      languageForFileName(filePath),
      uri
    );
  }
}

export function useEditorCrdtBindings({
  monacoApi,
  entries,
  openFileIds,
  providerRef,
  status,
  primaryEditor,
  secondaryEditor,
  activeFileId,
  splitFileId,
  broadcastCursor,
}: UseEditorCrdtBindingsOptions): void {
  useEffect(() => {
    const provider = providerRef.current;
    if (!monacoApi || !provider) return;
    createMissingEditorModels(monacoApi, entries, openFileIds, provider);
  }, [monacoApi, openFileIds, entries, providerRef]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!primaryEditor || !provider || !activeFileId) return;
    primaryEditor.setValue(provider.getFileContent(activeFileId));
    const binding = new MonacoCrdtBinding(
      primaryEditor,
      provider,
      activeFileId
    );
    const unsubscribeCursor = binding.onCursorChange(broadcastCursor);

    return () => {
      unsubscribeCursor();
      binding.dispose();
    };
  }, [primaryEditor, providerRef, status, broadcastCursor, activeFileId]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!secondaryEditor || !provider || !splitFileId) return;
    secondaryEditor.setValue(provider.getFileContent(splitFileId));
    const binding = new MonacoCrdtBinding(
      secondaryEditor,
      provider,
      splitFileId
    );
    return () => binding.dispose();
  }, [secondaryEditor, providerRef, status, splitFileId]);
}
