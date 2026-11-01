import type { IconType } from 'react-icons';
import {
  VscCommentDiscussion,
  VscFiles,
  VscPlay,
  VscSearch,
  VscSourceControl,
} from 'react-icons/vsc';
import { SHORTCUT_DEFINITIONS } from './shortcutDefinitions';

export type ActivityView = 'explorer' | 'search' | 'source-control' | 'run';

export interface ActivityBarProps {
  activeView: ActivityView | null;
  onSelect: (view: ActivityView) => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
}

const ACTIVITIES: Array<{
  id: ActivityView;
  label: string;
  icon: IconType;
}> = [
  { id: 'explorer', label: 'Explorer', icon: VscFiles },
  { id: 'search', label: 'Search', icon: VscSearch },
  {
    id: 'source-control',
    label: 'Source Control',
    icon: VscSourceControl,
  },
  { id: 'run', label: 'Run', icon: VscPlay },
];

export function ActivityBar({
  activeView,
  onSelect,
  isChatOpen,
  onToggleChat,
}: ActivityBarProps) {
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {ACTIVITIES.map(({ id, label, icon: ActivityIcon }) => (
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
          <ActivityIcon size={24} aria-hidden="true" />
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
        <VscCommentDiscussion size={24} aria-hidden="true" />
      </button>
    </nav>
  );
}

function activityShortcut(id: ActivityView): string {
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === id);
  return definition?.keys.join('+').replace('Ctrl', 'Control') ?? '';
}

function activityShortcutLabel(id: ActivityView): string {
  return (
    SHORTCUT_DEFINITIONS.find((item) => item.id === id)?.keys.join('+') ?? ''
  );
}
