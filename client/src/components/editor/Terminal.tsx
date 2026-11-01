import type { RefObject } from 'react';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { TerminalTabsVertical } from './TerminalToolbar';
import { TerminalView } from './TerminalView';
import { useTerminalTabs } from './useTerminalTabs';
import type { BottomPanelView, TerminalRunRequest } from './terminalTypes';

export interface TerminalProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  isPanelOpen: boolean;
  onEmpty: () => void;
  activeView: BottomPanelView;
  runRequest: TerminalRunRequest | null;
  onRunRequestClaimed: (requestId: string) => void;
}

export function Terminal(props: TerminalProps) {
  const { providerRef, status, isPanelOpen, onEmpty } = props;
  const {
    visibleTabs,
    visibleActiveId,
    terminalError,
    canStartBash,
    selectTab,
    closeTab,
    startBash,
  } = useTerminalTabs({
    providerRef,
    status,
    newTerminalRequest: props.newTerminalRequest,
    isPanelOpen,
    activeView: props.activeView,
    onEmpty,
  });

  return (
    <section className="execution-terminal-layout" aria-label="Terminal panel">
      <div className="execution-terminal-main">
        {props.activeView === 'terminal' && visibleTabs.length === 0 && (
          <div className="terminal-empty">
            {terminalError ? (
              <>
                <p>{terminalError}</p>
                <button
                  className="bottom-panel-action-btn"
                  type="button"
                  onClick={startBash}
                >
                  Try again
                </button>
              </>
            ) : status === 'connected' ? (
              'Starting isolated Bash…'
            ) : (
              'Connect to the room to start a terminal.'
            )}
          </div>
        )}
        {visibleTabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={
              props.activeView === 'terminal' && tab.id === visibleActiveId
            }
            providerRef={providerRef}
            runRequest={props.runRequest}
            onRunRequestClaimed={props.onRunRequestClaimed}
          />
        ))}
      </div>

      {props.activeView === 'terminal' && visibleTabs.length > 0 && (
        <TerminalTabsVertical
          tabs={visibleTabs}
          activeId={visibleActiveId}
          canStartBash={canStartBash}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onNewTab={startBash}
        />
      )}
    </section>
  );
}
