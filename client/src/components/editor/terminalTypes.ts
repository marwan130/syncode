import type { ExecutionLanguage } from '../../providers/SignalRCrdtProvider';

export interface TerminalTab {
  id: string;
  label: string;
  kind: 'bash';
  sessionId: string | null;
}

export interface TerminalRunRequest {
  id: string;
  language: ExecutionLanguage;
  sourcePath: string;
}

export type BottomPanelView = 'terminal' | 'problems';
