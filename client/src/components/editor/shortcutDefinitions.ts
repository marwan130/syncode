export interface ShortcutDefinition {
  id: string;
  label: string;
  keys: string[];
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'terminal-toggle',
    label: 'Toggle terminal panel',
    keys: ['Ctrl', 'Alt', 'T'],
  },
  {
    id: 'terminal-new',
    label: 'Open a new Bash terminal',
    keys: ['Ctrl', 'Alt', 'N'],
  },
  {
    id: 'terminal-close-tab',
    label: 'Close the active terminal tab',
    keys: ['Ctrl', 'Alt', 'Q'],
  },
  {
    id: 'run-active',
    label: 'Run the active file',
    keys: ['Ctrl', 'Alt', 'R'],
  },
  { id: 'explorer', label: 'Toggle Explorer', keys: ['Ctrl', 'Alt', 'E'] },
  { id: 'search', label: 'Toggle Search', keys: ['Ctrl', 'Alt', 'F'] },
  { id: 'source-control', label: 'Toggle GitHub', keys: ['Ctrl', 'Alt', 'G'] },
  { id: 'run', label: 'Toggle Run', keys: ['Ctrl', 'Alt', 'D'] },
  { id: 'chat', label: 'Toggle chat', keys: ['Ctrl', 'Alt', 'C'] },
  { id: 'preview', label: 'Toggle preview', keys: ['Ctrl', 'Alt', 'P'] },
  {
    id: 'split',
    label: 'Split the active editor group right',
    keys: ['Ctrl', 'Alt', 'S'],
  },
  { id: 'shortcuts', label: 'Show this guide', keys: ['Ctrl', 'Alt', 'K'] },
  { id: 'problems', label: 'Show Problems', keys: ['Ctrl', 'Alt', 'B'] },
  {
    id: 'focus-regions',
    label: 'Move through workspace regions',
    keys: ['F6', '/', 'Shift', '+', 'F6'],
  },
  {
    id: 'terminal-panel-close',
    label: 'Close terminal panel',
    keys: ['Ctrl', 'Alt', 'W'],
  },
  {
    id: 'command-palette',
    label: 'Editor commands',
    keys: ['Ctrl', 'Shift', 'P'],
  },
  { id: 'find', label: 'Find in file', keys: ['Ctrl', 'F'] },
  {
    id: 'indent',
    label: 'Indent / outdent line',
    keys: ['Tab', '/', 'Shift', '+', 'Tab'],
  },
  {
    id: 'explorer-navigation',
    label: 'Navigate file explorer items',
    keys: ['Home', 'End'],
  },
  {
    id: 'folder-navigation',
    label: 'Expand / collapse folders',
    keys: ['→', '/', '←'],
  },
  {
    id: 'terminal-navigation',
    label: 'Switch terminal tabs',
    keys: ['←', '/', '→'],
  },
  {
    id: 'bash-editing',
    label: 'Edit Bash command or history',
    keys: ['←', '→', 'Home', 'End', 'Backspace', 'Delete'],
  },
  { id: 'bash-run', label: 'Run Bash command', keys: ['Enter'] },
  { id: 'dialog-close', label: 'Close dialogs', keys: ['Esc'] },
];
