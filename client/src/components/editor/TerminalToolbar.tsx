import type { KeyboardEvent } from 'react';
import { VscAdd, VscClose, VscTerminal } from 'react-icons/vsc';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import type { TerminalTab } from './terminalTypes';

export interface TerminalTabsVerticalProps {
  tabs: TerminalTab[];
  activeId: string;
  canStartBash: boolean;
  onSelectTab: (tab: TerminalTab) => void;
  onCloseTab: (tab: TerminalTab) => void;
  onNewTab: () => void;
}

export function TerminalTabsVertical({
  tabs,
  activeId,
  canStartBash,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TerminalTabsVerticalProps) {
  return (
    <ScrollbarPanel
      as="aside"
      className="execution-terminal-sidebar"
      aria-label="Terminal sessions"
    >
      <div
        className="execution-terminal-tabs-vertical"
        role="tablist"
        aria-label="Terminal tabs"
      >
        <div className="execution-terminal-tabs-list">
          {tabs.map((tab) => (
            <div
              className={`execution-terminal-tab-vertical${activeId === tab.id ? ' is-active' : ''}`}
              key={tab.id}
            >
              <button
                className="terminal-tab-select"
                id={`terminal-tab-${tab.id}`}
                role="tab"
                aria-controls={`terminal-panel-${tab.id}`}
                aria-selected={activeId === tab.id}
                tabIndex={activeId === tab.id ? 0 : -1}
                onClick={() => onSelectTab(tab)}
                onKeyDown={focusAdjacentTerminalTab}
              >
                <VscTerminal className="terminal-tab-icon" aria-hidden="true" />
                <span className="terminal-tab-label">{tab.label}</span>
              </button>
              <button
                className="terminal-tab-close"
                aria-label={`Close ${tab.label}`}
                onClick={() => onCloseTab(tab)}
                title="Kill terminal"
              >
                <VscClose aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button
          className="terminal-new-tab-vertical"
          onClick={onNewTab}
          disabled={!canStartBash}
          title="New Bash terminal"
        >
          <VscAdd aria-hidden="true" />
          <span>New Terminal</span>
        </button>
      </div>
    </ScrollbarPanel>
  );
}

// Backwards-compatible alias if referenced elsewhere

function focusAdjacentTerminalTab(
  event: KeyboardEvent<HTMLButtonElement>
): void {
  if (!isArrowKey(event.key)) return;
  event.preventDefault();
  const buttons = getTerminalTabButtons(event.currentTarget);
  const next = getAdjacentTab(buttons, event.currentTarget, event.key);
  next?.focus();
  next?.click();
}

function isArrowKey(
  key: string
): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' {
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight'
  );
}

function getTerminalTabButtons(
  current: HTMLButtonElement
): HTMLButtonElement[] {
  const tabList = current.closest('[role="tablist"]');
  return Array.from(
    tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
  );
}

function getAdjacentTab(
  buttons: HTMLButtonElement[],
  current: HTMLButtonElement,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
): HTMLButtonElement | undefined {
  if (buttons.length === 0) return undefined;
  const direction = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
  const index = buttons.indexOf(current);
  return buttons[(index + direction + buttons.length) % buttons.length];
}
