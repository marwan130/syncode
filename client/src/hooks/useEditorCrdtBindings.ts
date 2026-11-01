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

/** statuses where cursor broadcast should be suppressed */
const OFFLINE_STATUSES = new Set<ConnectionStatus>([
  'offline',
  'reconnecting',
  'disconnected',
]);

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
    const uri = monacoApi.Uri.parse(
      getEditorModelPath(provider.getRoomId(), fileId)
    );
    if (monacoApi.editor.getModel(uri)) continue;
    monacoApi.editor.createModel(
      provider.getFileContent(fileId),
      languageForFileName(getEntryPath(entry, entries)),
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
  const broadcastCursorRef = useRef(broadcastCursor);
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

  // keep broadcastCursor ref fresh so the binding always sees the latest
  // callback without needing to be recreated
  useEffect(() => {
    broadcastCursorRef.current = broadcastCursor;
  }, [broadcastCursor]);

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

  // Bindings are intentionally NOT torn down when `status` changes.
  // Tearing down and re-creating the binding during reconnect resets the
  // Monaco model via model.setValue(), discarding any text the user typed
  // while offline. The binding itself is connection-agnostic: local edits
  // accumulate in the CRDT document and are synced separately once the
  // connection is restored.
  //
  // Cursor broadcasting is suppressed via a separate effect below.
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const bindings: Array<{
      binding: MonacoCrdtBinding;
      unsubscribeCursor: () => void;
    }> = [];

    // Stable cursor relay: forwards cursor events only when online.
    // Using a ref for broadcastCursor means we never need to recreate
    // the binding when the callback identity changes.
    const relayCursor = (cursor: CursorAnchor | null): void => {
      if (!OFFLINE_STATUSES.has(status)) {
        broadcastCursorRef.current(cursor);
      }
    };

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
      const unsubscribeCursor = binding.onCursorChange(relayCursor);
      bindings.push({ binding, unsubscribeCursor });
    }

    return () => {
      for (const { binding, unsubscribeCursor } of bindings) {
        unsubscribeCursor();
        binding.dispose();
      }
    };
    // `status` and `broadcastCursor` are intentionally absent from deps:
    // status changes are handled via OFFLINE_STATUSES inside relayCursor,
    // and broadcastCursor updates are handled via broadcastCursorRef.
    // Only structural changes (new editor / file switch / new provider)
    // should recreate bindings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editors, bindingsKey, providerRef]);
}
