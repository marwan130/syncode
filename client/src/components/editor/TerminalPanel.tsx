import { lazy, Suspense } from 'react';
import type { FC, RefObject } from 'react';
import { VerticalResizeHandle } from './VerticalResizeHandle';
import {
  DEFAULT_TERMINAL_HEIGHT,
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

interface TerminalPanelProps {
  isOpen: boolean;
  height: number;
  chunks: TerminalOutputChunk[];
  outputRevision: number;
  message: string;
  jobId: string | null;
  isRunning: boolean;
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
  height,
  chunks,
  outputRevision,
  message,
  jobId,
  isRunning,
  providerRef,
  status,
  newTerminalRequest,
  startBashOnMount,
  onHeightChange,
  onClose,
  onEmpty,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <VerticalResizeHandle
        label="Resize terminal panel"
        onResize={(delta) => {
          const next = height + delta;
          if (next <= 32) {
            onClose();
            onHeightChange(DEFAULT_TERMINAL_HEIGHT);
            storeTerminalHeight(DEFAULT_TERMINAL_HEIGHT);
            return;
          }
          const nextHeight = Math.min(window.innerHeight - 100, next);
          onHeightChange(nextHeight);
          storeTerminalHeight(nextHeight);
        }}
      />
      <div className="terminal-panel-sized" style={{ flexBasis: height }}>
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
            isRunning={isRunning}
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
