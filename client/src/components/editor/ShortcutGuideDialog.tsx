import { useEffect, useRef } from 'react';
import type { FC } from 'react';

interface ShortcutGuideDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ label: string; keys: string[] }> = [
  { label: 'Toggle terminal panel', keys: ['Ctrl', 'Alt', 'T'] },
  { label: 'Open a new Bash terminal', keys: ['Ctrl', 'Alt', 'N'] },
  { label: 'Close the active terminal tab', keys: ['Ctrl', 'Alt', 'Q'] },
  { label: 'Run the active file', keys: ['Ctrl', 'Alt', 'R'] },
  { label: 'Toggle file explorer', keys: ['Ctrl', 'Alt', 'E'] },
  { label: 'Toggle chat', keys: ['Ctrl', 'Alt', 'C'] },
  { label: 'Toggle preview', keys: ['Ctrl', 'Alt', 'P'] },
  { label: 'Show this guide', keys: ['Ctrl', 'Alt', 'K'] },
  {
    label: 'Move through workspace regions',
    keys: ['F6', '/', 'Shift', '+', 'F6'],
  },
  { label: 'Close terminal panel', keys: ['Ctrl', 'Alt', 'W'] },
  { label: 'Editor commands', keys: ['Ctrl', 'Shift', 'P'] },
  { label: 'Find in file', keys: ['Ctrl', 'F'] },
  { label: 'Indent / outdent line', keys: ['Tab', '/', 'Shift', '+', 'Tab'] },
  {
    label: 'Navigate file explorer items',
    keys: ['↑', '/', '↓', 'Home', 'End'],
  },
  { label: 'Expand / collapse folders', keys: ['→', '/', '←'] },
  { label: 'Switch terminal tabs', keys: ['←', '/', '→'] },
  {
    label: 'Edit Bash command or history',
    keys: ['←', '→', '↑', '↓', 'Home', 'End', 'Backspace', 'Delete'],
  },
  { label: 'Run Bash command', keys: ['Enter'] },
  { label: 'Close this guide', keys: ['Esc'] },
];

export const ShortcutGuideDialog: FC<ShortcutGuideDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>('button')?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((item) => !item.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', trapFocus);
    return () => {
      window.removeEventListener('keydown', trapFocus);
      previous?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="shortcut-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="shortcut-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
        tabIndex={-1}
      >
        <header>
          <h2 id="shortcut-dialog-title">Keyboard shortcuts</h2>
        </header>
        <dl>
          {SHORTCUTS.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                {item.keys.map((key, index) =>
                  key === '+' || key === '/' ? (
                    ` ${key} `
                  ) : (
                    <kbd key={index}>{key}</kbd>
                  )
                )}
              </dd>
            </div>
          ))}
        </dl>
        <footer>
          <span>
            Use <kbd>Tab</kbd> and <kbd>Shift</kbd> + <kbd>Tab</kbd> to move
            between controls.
          </span>
        </footer>
      </section>
    </div>
  );
};
