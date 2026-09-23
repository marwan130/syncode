import { useEffect, useState } from 'react';
import type * as monacoType from 'monaco-editor';
import type { RefObject } from 'react';
import { resolveCursorAnchor } from '../../crdt/CursorAnchor';
import type {
  AwarenessState,
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';

interface CursorsProps {
  editor: monacoType.editor.IStandaloneCodeEditor;
  peers: Map<string, AwarenessState>;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
}

interface RenderedCursor {
  peerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  height: number;
}

/**
 * resolves each remote peer's crdt cursor anchor to a pixel position using
 * monaco's getScrolledVisiblePosition, then renders absolutely-positioned
 * colored carets + name labels over the editor content area.
 *
 * re-runs whenever the document changes, peers change, or the editor scrolls.
 */
export function Cursors({ editor, peers, providerRef, status }: CursorsProps) {
  const [cursors, setCursors] = useState<RenderedCursor[]>([]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    const doc = provider.doc;

    function recompute() {
      const next: RenderedCursor[] = [];

      for (const [peerId, state] of peers) {
        if (!state.cursor) continue;

        const resolved = resolveCursorAnchor(doc, state.cursor);
        const pos = editor.getScrolledVisiblePosition({
          lineNumber: resolved.lineNumber,
          column: resolved.column,
        });

        if (pos != null) {
          next.push({
            peerId,
            name: state.name,
            color: state.color,
            x: pos.left,
            y: pos.top,
            height: pos.height,
          });
        }
      }

      setCursors(next);
    }

    recompute();

    const disposables = [
      editor.onDidScrollChange(recompute),
      editor.onDidLayoutChange(recompute),
    ];
    const unsubscribeDocument = provider.onDocumentChange(recompute);

    return () => {
      disposables.forEach((d) => d.dispose());
      unsubscribeDocument();
    };
  }, [editor, peers, providerRef, status]);

  if (cursors.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {cursors.map((c) => (
        <div
          key={c.peerId}
          style={{ position: 'absolute', left: c.x, top: c.y }}
        >
          <div
            className="syncode-cursor-caret"
            style={{
              position: 'absolute',
              width: 2,
              height: c.height || 18,
              background: c.color,
              top: 0,
              left: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: -18,
              left: 0,
              background: c.color,
              color: '#fff',
              fontSize: 11,
              fontFamily: 'system-ui, sans-serif',
              padding: '1px 5px',
              borderRadius: '3px 3px 3px 0',
              whiteSpace: 'nowrap',
              lineHeight: '16px',
            }}
          >
            {c.name}
          </div>
        </div>
      ))}
    </div>
  );
}
