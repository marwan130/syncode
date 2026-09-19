import type * as monaco from 'monaco-editor';
import type { CrdtId } from '../crdt/CrdtId';
import { crdtIdToString } from '../crdt/CrdtId';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';

/**
 * bridges a monaco editor instance and a signalr crdt provider.
 *
 * local changes: intercepts monaco's onDidChangeContent events and maps each
 * change range into individual crdt insert/delete operations.
 *
 * remote changes: when the provider fires onDocumentChange, the new visible
 * text is pushed back into monaco using executeEdits so the undo stack and
 * cursor position are preserved.
 *
 * isApplyingRemote prevents echo loops.
 */
export class MonacoCrdtBinding {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private provider: SignalRCrdtProvider;
  private isApplyingRemote = false;
  private disposables: monaco.IDisposable[] = [];

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    provider: SignalRCrdtProvider
  ) {
    this.editor = editor;
    this.provider = provider;

    this.registerLocalChangeHandler();
    this.registerRemoteChangeHandler();
  }

  /**
   * listens to monaco content changes and maps each change to a sequence of
   * individual crdt insert / delete operations.
   *
   * changes are processed in reverse offset order so earlier deletions don't
   * shift the offsets of later ones in the same batch.
   */
  private registerLocalChangeHandler(): void {
    const model = this.editor.getModel();
    if (!model) return;

    const disposable = model.onDidChangeContent(
      (event: monaco.editor.IModelContentChangedEvent) => {
        if (this.isApplyingRemote) return;

        const changes = [...event.changes].sort(
          (a, b) => b.rangeOffset - a.rangeOffset
        );

        for (const change of changes) {
          this.applyLocalChange(
            change.rangeOffset,
            change.rangeLength,
            change.text
          );
        }
      }
    );

    this.disposables.push(disposable);
  }

  private applyLocalChange(
    offset: number,
    deleteCount: number,
    insertedText: string
  ): void {
    const doc = this.provider.doc;

    /**
     * build an index of visible characters so we can map monaco's
     * character offsets to crdt character ids
     */
    const visibleChars = doc.chars.filter((c) => !c.isDeleted);

    for (let i = 0; i < deleteCount; i++) {
      const char = visibleChars[offset + i];
      if (char) {
        this.provider.localDelete(char.id).catch((err) => {
          console.error('[MonacoCrdtBinding] localDelete failed:', err);
        });
      }
    }

    let originId: CrdtId | null =
      offset > 0 ? (visibleChars[offset - 1]?.id ?? null) : null;

    for (const ch of insertedText) {
      this.provider.localInsert(originId, ch).catch((err) => {
        console.error('[MonacoCrdtBinding] localInsert failed:', err);
      });

      const freshVisible = this.provider.doc.chars.filter((c) => !c.isDeleted);
      const inserted = freshVisible.find(
        (c) =>
          !visibleChars.some(
            (v) => crdtIdToString(v.id) === crdtIdToString(c.id)
          )
      );
      if (inserted) {
        originId = inserted.id;
        visibleChars.splice(offset, 0, inserted);
      }
    }
  }

  /**
   * we snapshot the current selections before applying the change and restore
   * them afterwards to avoid jumping the cursor on remote edits that don't
   * overlap the local cursor position.
   */
  private registerRemoteChangeHandler(): void {
    const unsubscribe = this.provider.onDocumentChange(() => {
      if (this.isApplyingRemote) return;

      const newText = this.provider.doc.toVisibleString();
      const model = this.editor.getModel();
      if (!model) return;

      const currentText = model.getValue();
      if (currentText === newText) return;

      this.isApplyingRemote = true;
      try {
        const selections = this.editor.getSelections();
        const fullRange = model.getFullModelRange();

        this.editor.executeEdits('crdt-remote', [
          {
            range: fullRange,
            text: newText,
            forceMoveMarkers: true,
          },
        ]);

        if (selections) {
          this.editor.setSelections(selections);
        }
      } finally {
        this.isApplyingRemote = false;
      }
    });

    this.disposables.push({ dispose: unsubscribe });
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
