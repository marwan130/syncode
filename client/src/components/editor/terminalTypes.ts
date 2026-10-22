export interface TerminalTab {
  id: string;
  label: string;
  kind: 'bash' | 'output';
  sessionId: string | null;
}
