import type { RefObject } from 'react';
import type { TerminalOutputChunk } from '../../hooks/useExecutionStream';
import type {
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalView } from './TerminalView';
import { useTerminalTabs } from './useTerminalTabs';

export interface TerminalProps {
  chunks: TerminalOutputChunk[];
  outputRevision: number;
  message: string;
  jobId: string | null;
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  newTerminalRequest: number;
  startBashOnMount: boolean;
  onClose: () => void;
  onEmpty: () => void;
}

export function Terminal(props: TerminalProps) {
  const { providerRef, status, startBashOnMount, outputRevision, onEmpty } =
    props;
  const {
    visibleTabs,
    visibleActiveId,
    terminalError,
    canStartBash,
    selectTab,
    closeTab,
    startBash,
  } = useTerminalTabs({
    outputRevision,
    providerRef,
    status,
    newTerminalRequest: props.newTerminalRequest,
    startBashOnMount,
    onEmpty,
  });

  return (
    <section className="execution-terminal" aria-label="Terminal panel">
      <TerminalToolbar
        tabs={visibleTabs}
        activeId={visibleActiveId}
        canStartBash={canStartBash}
        statusMessage={
          terminalError || (props.message === 'Ready' ? '' : props.message)
        }
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onNewTab={startBash}
        onClosePanel={props.onClose}
      />
      {visibleTabs.length === 0 && (
        <div className="terminal-empty">
          {terminalError ||
            (status === 'connected'
              ? 'Starting isolated Bash…'
              : 'Connect to the room to start a terminal.')}
        </div>
      )}
      {visibleTabs.map((tab) => (
        <TerminalView
          key={tab.id}
          tab={tab}
          active={tab.id === visibleActiveId}
          jobId={tab.kind === 'output' ? props.jobId : null}
          providerRef={providerRef}
          chunks={tab.kind === 'output' ? props.chunks : []}
          outputRevision={outputRevision}
        />
      ))}
    </section>
  );
}
