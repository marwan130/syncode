import { lazy, Suspense } from 'react';
import type { FC, RefObject } from 'react';
import { VerticalResizeHandle } from './VerticalResizeHandle';
import {
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  storeTerminalHeight,
} from './editorLayoutStorage';
import type { TerminalOutputChunk } from '../../hooks/useExecutionStream';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';

const Terminal = lazy(() =>
  import('./Terminal').then((module) => ({ default: module.Terminal }))
);

export interface TerminalPanelProps {
  isOpen: boolean;
  hasOpened: boolean;
  height: number;
  chunks: TerminalOutputChunk[];
  outputRevision: number;
  message: string;
  jobId: string | null;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  startBashOnMount: boolean;
  onHeightChange: (height: number) => void;
  onClose: () => void;
  onEmpty: () => void;
}

export const TerminalPanel: FC<TerminalPanelProps> = ({
  isOpen,
  hasOpened,
  height,
  chunks,
  outputRevision,
  message,
  jobId,
  providerRef,
  status,
  newTerminalRequest,
  startBashOnMount,
  onHeightChange,
  onClose,
  onEmpty,
}) => {
  if (!isOpen && !hasOpened) return null;

  return (
    <>
      {isOpen && (
        <VerticalResizeHandle
          label="Resize terminal panel"
          onResize={(delta) => {
            const next = height + delta;
            if (next < MIN_TERMINAL_HEIGHT) {
              onClose();
              onHeightChange(DEFAULT_TERMINAL_HEIGHT);
              storeTerminalHeight(DEFAULT_TERMINAL_HEIGHT);
              return;
            }
            const nextHeight = Math.max(
              MIN_TERMINAL_HEIGHT,
              Math.min(window.innerHeight - 100, next)
            );
            onHeightChange(nextHeight);
            storeTerminalHeight(nextHeight);
          }}
        />
      )}
      <div
        className="terminal-panel-sized"
        style={{ flexBasis: height, display: isOpen ? undefined : 'none' }}
        aria-hidden={!isOpen}
      >
        <Suspense
          fallback={
            <div className="execution-terminal-loading">Opening terminal…</div>
          }
        >
          <Terminal
            chunks={chunks}
            outputRevision={outputRevision}
            message={message}
            jobId={jobId}
            providerRef={providerRef}
            status={status}
            newTerminalRequest={newTerminalRequest}
            startBashOnMount={startBashOnMount}
            onClose={onClose}
            onEmpty={onEmpty}
          />
        </Suspense>
      </div>
    </>
  );
};
