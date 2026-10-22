import type { TerminalTab } from './terminalTypes';

export interface TerminalToolbarProps {
  tabs: TerminalTab[];
  activeId: string;
  canStartBash: boolean;
  statusMessage: string;
  onSelectTab: (tab: TerminalTab) => void;
  onCloseTab: (tab: TerminalTab) => void;
  onNewTab: () => void;
  onClosePanel: () => void;
}

export function TerminalToolbar({
  tabs,
  activeId,
  canStartBash,
  statusMessage,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onClosePanel,
}: TerminalToolbarProps) {
  return (
    <div className="execution-terminal-titlebar">
      <strong>TERMINAL</strong>
      <div
        className="execution-terminal-tabs"
        role="tablist"
        aria-label="Terminal tabs"
      >
        {tabs.map((tab) => (
          <div
            className={`execution-terminal-tab${activeId === tab.id ? ' is-active' : ''}`}
            key={tab.id}
          >
            <button
              id={`terminal-tab-${tab.id}`}
              role="tab"
              aria-controls={`terminal-panel-${tab.id}`}
              aria-selected={activeId === tab.id}
              tabIndex={activeId === tab.id ? 0 : -1}
              onClick={() => onSelectTab(tab)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                  return;
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget
                    .closest('[role="tablist"]')
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
                );
                const index = buttons.indexOf(event.currentTarget);
                const next =
                  buttons[
                    (index +
                      (event.key === 'ArrowRight' ? 1 : -1) +
                      buttons.length) %
                      buttons.length
                  ];
                next?.focus();
                next?.click();
              }}
            >
              {tab.label}
            </button>
            <button
              className="terminal-tab-close"
              aria-label={`Close ${tab.label}`}
              onClick={() => onCloseTab(tab)}
              title="Kill (Delete)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M5.5 2h5l.6 1.5H14v1.4H2V3.5h2.9L5.5 2Zm-1.7 4h8.4l-.5 7.5H4.3L3.8 6Zm2 .9.3 5.7h1.2l-.2-5.7H5.8Zm3.2 0-.2 5.7H10l.3-5.7H9Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        ))}
        <button
          className="terminal-new-tab"
          onClick={onNewTab}
          disabled={!canStartBash}
          title="New Bash terminal"
        >
          +
        </button>
      </div>
      <span className="execution-terminal-status" role="status">
        {statusMessage}
      </span>
      <div className="execution-terminal-actions">
        <button
          className="terminal-panel-close"
          type="button"
          onClick={onClosePanel}
          title="Close terminal panel"
        >
          Close
        </button>
      </div>
    </div>
  );
}
