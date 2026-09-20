import type * as monaco from 'monaco-editor';
import type { CrdtId } from '../crdt/CrdtId';
import { crdtIdToString } from '../crdt/CrdtId';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { CursorAnchor } from '../crdt/CursorAnchor';
import { createCursorAnchor, resolveCursorAnchor } from '../crdt/CursorAnchor';

/**
 * bridges a monaco editor instance and a signalr crdt provider.
 *
 * local changes: intercepts monaco's onDidChangeContent events and maps each
 * change range into individual crdt insert/delete operations.
 *
 * remote changes: when the provider fires onDocumentChange, the new visible
 * text is pushed back into monaco using executeEdits. cursor position is
 * restored using a crdt cursor anchor so it stays attached to the same text.
 *
 * isApplyingRemote prevents echo loops.
 */
export class MonacoCrdtBinding {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private provider: SignalRCrdtProvider;
  private isApplyingRemote = false;
  private disposables: monaco.IDisposable[] = [];
  private localCursorAnchor: CursorAnchor | null = null;
  private cursorListeners: Set<(anchor: CursorAnchor | null) => void> =
    new Set();

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    provider: SignalRCrdtProvider
  ) {
    this.editor = editor;
    this.provider = provider;

    this.registerLocalChangeHandler();
    this.registerRemoteChangeHandler();
    this.registerCursorHandler();
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

        this.updateLocalCursorAnchor();
      }
    );

    this.disposables.push(disposable);
  }

  /**
   * tracks cursor movements so we can anchor the cursor to a crdt character id
   */
  private registerCursorHandler(): void {
    const disposable = this.editor.onDidChangeCursorPosition(() => {
      this.updateLocalCursorAnchor();
    });

    this.disposables.push(disposable);
    this.updateLocalCursorAnchor();
  }

  private updateLocalCursorAnchor(): void {
    if (this.isApplyingRemote) return;

    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position) return;

    const offset = model.getOffsetAt(position);
    this.localCursorAnchor = createCursorAnchor(this.provider.doc, offset);
    this.cursorListeners.forEach((l) => l(this.localCursorAnchor));
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
   * applies remote document changes and restores the cursor position using
   * the cursor anchor so it stays attached to the same character
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
        const fullRange = model.getFullModelRange();

        this.editor.executeEdits('crdt-remote', [
          {
            range: fullRange,
            text: newText,
            forceMoveMarkers: true,
          },
        ]);

        if (this.localCursorAnchor) {
          const resolved = resolveCursorAnchor(
            this.provider.doc,
            this.localCursorAnchor
          );
          this.editor.setPosition({
            lineNumber: resolved.lineNumber,
            column: resolved.column,
          });
        }
      } finally {
        this.isApplyingRemote = false;
      }
    });

    this.disposables.push({ dispose: unsubscribe });
  }

  public onCursorChange(
    listener: (anchor: CursorAnchor | null) => void
  ): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  public getLocalCursorAnchor(): CursorAnchor | null {
    return this.localCursorAnchor;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.cursorListeners.clear();
  }
}
