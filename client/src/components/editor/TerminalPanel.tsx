import { lazy, Suspense } from 'react';
import type { FC, RefObject } from 'react';
import { VerticalResizeHandle } from './VerticalResizeHandle';
import {
  DEFAULT_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  storeTerminalHeight,
} from './editorLayoutStorage';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import type { FileProblem } from '../../hooks/useFileDiagnostics';
import type { BottomPanelView } from './terminalTypes';
import type { TerminalRunRequest } from './terminalTypes';
import { Icon } from '@iconify/react';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

const Terminal = lazy(() =>
  import('./Terminal').then((module) => ({ default: module.Terminal }))
);

export interface TerminalPanelProps {
  isOpen: boolean;
  hasOpened: boolean;
  height: number;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  onHeightChange: (height: number) => void;
  onClose: () => void;
  onEmpty: () => void;
  activeView: BottomPanelView;
  onSelectView: (view: BottomPanelView) => void;
  problems: FileProblem[];
  onOpenProblem: (fileId: string, line: number) => void;
  runRequest: TerminalRunRequest | null;
  onRunRequestClaimed: (requestId: string) => void;
  onRun?: () => void;
  canRun?: boolean;
  runDisabledReason?: string;
}

export const TerminalPanel: FC<TerminalPanelProps> = ({
  isOpen,
  hasOpened,
  height,
  providerRef,
  status,
  newTerminalRequest,
  onHeightChange,
  onClose,
  onEmpty,
  activeView,
  onSelectView,
  problems,
  onOpenProblem,
  runRequest,
  onRunRequestClaimed,
  onRun,
  canRun,
  runDisabledReason,
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
        <div className="bottom-panel-content">
          <div className="bottom-panel-header">
            <nav
              className="bottom-panel-tabs"
              aria-label="Bottom panel views"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'terminal'}
                onClick={() => onSelectView('terminal')}
              >
                Terminal
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeView === 'problems'}
                onClick={() => onSelectView('problems')}
              >
                Problems {problems.length > 0 && <span>{problems.length}</span>}
              </button>
            </nav>
            <div className="bottom-panel-actions">
              {onRun && (
                <button
                  type="button"
                  className="bottom-panel-action-btn"
                  onClick={onRun}
                  disabled={canRun === false}
                  title={runDisabledReason || 'Run code'}
                >
                  <Icon icon="codicon:play" aria-hidden="true" />
                  <span>Run</span>
                </button>
              )}
              <button
                type="button"
                className="bottom-panel-action-btn terminal-panel-close"
                onClick={onClose}
                title="Close panel"
                aria-label="Close panel"
              >
                <Icon icon="codicon:close" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="bottom-panel-view" hidden={activeView === 'problems'}>
            <Suspense
              fallback={
                <div className="execution-terminal-loading">
                  Opening terminal…
                </div>
              }
            >
              <Terminal
                providerRef={providerRef}
                status={status}
                newTerminalRequest={newTerminalRequest}
                isPanelOpen={isOpen}
                onEmpty={onEmpty}
                activeView={activeView}
                runRequest={runRequest}
                onRunRequestClaimed={onRunRequestClaimed}
              />
            </Suspense>
          </div>
          {activeView === 'problems' && (
            <ScrollbarPanel
              className="problems-list"
              role="tabpanel"
              aria-label="Problems"
            >
              {problems.length === 0 ? (
                <p>No problems detected.</p>
              ) : (
                problems.map((problem, index) => (
                  <button
                    type="button"
                    className="problem-item"
                    key={`${problem.fileId}:${problem.line}:${problem.column}:${index}`}
                    onClick={() => onOpenProblem(problem.fileId, problem.line)}
                  >
                    <Icon
                      icon={
                        problem.severity === 'error'
                          ? 'codicon:error'
                          : 'codicon:warning'
                      }
                      aria-hidden="true"
                    />
                    <span>{problem.message}</span>
                    <strong>
                      {problem.path}:{problem.line}
                    </strong>
                  </button>
                ))
              )}
            </ScrollbarPanel>
          )}
        </div>
      </div>
    </>
  );
};
