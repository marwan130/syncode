import { Icon } from '@iconify/react';

export type ActivityView =
  'explorer' | 'search' | 'source-control' | 'run';

interface ActivityBarProps {
  activeView: ActivityView | null;
  onSelect: (view: ActivityView) => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
}

const ACTIVITIES: Array<{ id: ActivityView; label: string; icon: string }> = [
  { id: 'explorer', label: 'Explorer', icon: 'codicon:files' },
  { id: 'search', label: 'Search', icon: 'codicon:search' },
  {
    id: 'source-control',
    label: 'Source Control',
    icon: 'codicon:source-control',
  },
  { id: 'run', label: 'Run', icon: 'codicon:play' },
];

export function ActivityBar({
  activeView,
  onSelect,
  isChatOpen,
  onToggleChat,
}: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {ACTIVITIES.map(({ id, label, icon }) => (
        <button
          key={id}
          className={`activity-bar-button${activeView === id ? ' is-active' : ''}`}
          type="button"
          aria-label={label}
          aria-pressed={activeView === id}
          aria-keyshortcuts={activityShortcut(id)}
          title={`${label} (${activityShortcutLabel(id)})`}
          onClick={() => onSelect(id)}
        >
          <Icon icon={icon} aria-hidden="true" />
        </button>
      ))}
      <button
        className={`activity-bar-button${isChatOpen ? ' is-active' : ''}`}
        type="button"
        aria-label="Chat"
        aria-pressed={isChatOpen}
        aria-keyshortcuts="Control+Alt+C"
        title="Chat (Ctrl+Alt+C)"
        onClick={onToggleChat}
      >
        <Icon icon="codicon:comment-discussion" aria-hidden="true" />
      </button>
    </nav>
  );
}

function activityShortcut(id: ActivityView): string {
  switch (id) {
    case 'explorer':
      return 'Control+Alt+E';
    case 'search':
      return 'Control+Alt+F';
    case 'source-control':
      return 'Control+Alt+G';
    case 'run':
      return 'Control+Alt+D';
  }
}

function activityShortcutLabel(id: ActivityView): string {
  return activityShortcut(id).replace('Control', 'Ctrl');
}
