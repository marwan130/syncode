import type { FC } from 'react';
import { Icon } from '@iconify/react';
import { SHORTCUT_DEFINITIONS } from './shortcutDefinitions';

export interface EditorWelcomeActions {
  canEdit: boolean;
  canImport: boolean;
  onNewFile: () => void;
  onOpenFileLocal: () => void;
  onOpenFolderLocal: () => void;
  onOpenGithub: () => void;
}

export interface EditorWelcomePaneProps {
  welcome?: EditorWelcomeActions;
}

export const EditorWelcomePane: FC<EditorWelcomePaneProps> = ({ welcome }) => {
  const shortcut = (id: string) =>
    SHORTCUT_DEFINITIONS.find((item) => item.id === id)?.keys.join('+') ?? '';

  return (
    <div className="editor-empty-pane">
      <div className="editor-welcome">
        <h1>Syncode</h1>
        <section aria-label="Welcome actions">
          <WelcomeAction
            icon="codicon:new-file"
            label="New File"
            hint={shortcut('explorer')}
            disabled={!welcome?.canEdit}
            onClick={() => welcome?.onNewFile()}
          />
          <WelcomeAction
            icon="codicon:go-to-file"
            label="Open File"
            disabled={!welcome?.canImport}
            onClick={() => welcome?.onOpenFileLocal()}
          />
          <WelcomeAction
            icon="codicon:folder-opened"
            label="Open Folder"
            disabled={!welcome?.canImport}
            onClick={() => welcome?.onOpenFolderLocal()}
          />
          <WelcomeAction
            icon="codicon:github"
            label="Open GitHub Repository"
            hint={shortcut('source-control')}
            disabled={!welcome?.canImport}
            onClick={() => welcome?.onOpenGithub()}
          />
        </section>
      </div>
    </div>
  );
};

function WelcomeAction({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="editor-welcome-action">
      <Icon className="editor-welcome-icon" icon={icon} aria-hidden="true" />
      <button
        type="button"
        className="editor-welcome-action-trigger"
        disabled={disabled}
        onClick={onClick}
      >
        <span className="editor-welcome-label">{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
    </div>
  );
}
