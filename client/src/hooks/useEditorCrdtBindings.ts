import { useEffect, useRef } from 'react';
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
import {
  getEditorModelPath,
  getEntryPath,
} from '../components/editor/editorLayoutStorage';
import { languageForFileName } from '../components/editor/languageModes';
import type { EditorGroupState } from '../components/editor/editorGroups';

export interface UseEditorCrdtBindingsOptions {
  monacoApi: Monaco | null;
  entries: RoomEntry[];
  editorGroups: EditorGroupState[];
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  editors: Map<string, monaco.editor.IStandaloneCodeEditor>;
  broadcastCursor: (cursor: CursorAnchor | null) => void;
}

function createMissingEditorModels(
  monacoApi: Monaco,
  entries: RoomEntry[],
  editorGroups: EditorGroupState[],
  provider: SignalRCrdtProvider
): void {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const openFileIds = new Set(editorGroups.flatMap((group) => group.fileIds));
  for (const fileId of openFileIds) {
    const entry = entriesById.get(fileId);
    if (!entry || entry.isFolder) continue;
    const filePath = getEntryPath(entry, entries);
    const uri = monacoApi.Uri.parse(
      getEditorModelPath(provider.getRoomId(), filePath)
    );
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
  editorGroups,
  providerRef,
  status,
  editors,
  broadcastCursor,
}: UseEditorCrdtBindingsOptions): void {
  const editorGroupsRef = useRef(editorGroups);
  const openFileIdsKey = Array.from(
    new Set(editorGroups.flatMap((group) => group.fileIds))
  )
    .sort()
    .join('\u0000');
  const bindingsKey = editorGroups
    .map((group) => `${group.id}:${group.activeFileId}`)
    .join('\u0000');

  useEffect(() => {
    editorGroupsRef.current = editorGroups;
  }, [editorGroups]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!monacoApi || !provider) return;
    createMissingEditorModels(
      monacoApi,
      entries,
      editorGroupsRef.current,
      provider
    );
  }, [monacoApi, openFileIdsKey, entries, providerRef]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const bindings: Array<{
      binding: MonacoCrdtBinding;
      unsubscribeCursor: () => void;
    }> = [];

    for (const group of editorGroupsRef.current) {
      const editor = editors.get(group.id);
      if (!editor || !group.activeFileId) continue;
      const content = provider.getFileContent(group.activeFileId);
      const model = editor.getModel();
      if (model && model.getValue() !== content) model.setValue(content);
      const binding = new MonacoCrdtBinding(
        editor,
        provider,
        group.activeFileId
      );
      const unsubscribeCursor = binding.onCursorChange(broadcastCursor);
      bindings.push({ binding, unsubscribeCursor });
    }

    return () => {
      for (const { binding, unsubscribeCursor } of bindings) {
        unsubscribeCursor();
        binding.dispose();
      }
    };
  }, [editors, bindingsKey, providerRef, status, broadcastCursor]);
}
