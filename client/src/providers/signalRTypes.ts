import type { CursorAnchor } from '../crdt/CursorAnchor';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'awaiting-approval'
  | 'join-rejected';

export interface RoomJoinRequest {
  requestId: string;
  displayName: string;
  color: string;
  avatarUrl?: string;
}

export interface AwarenessState {
  cursor: CursorAnchor | null;
  name: string;
  color: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ParticipantInfo {
  connectionId: string;
  memberId?: string;
  displayName: string;
  color: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ChatMessage {
  id: string;
  author: string;
  color: string;
  content: string;
  sentAt: string;
}

export type ExecutionLanguage =
  | 'JavaScript'
  | 'TypeScript'
  | 'Python'
  | 'CSharp'
  | 'C'
  | 'Cpp'
  | 'Rust'
  | 'Java';

export interface TerminalSessionStart {
  sessionId: string;
}

export interface TerminalWorkspaceEntry {
  path: string;
  isFolder: boolean;
  content: string;
  previousContent?: string | null;
}

export interface TerminalOutput {
  text: string;
  offset: number;
  exited: boolean;
  exitCode: number | null;
  changedEntries: TerminalWorkspaceEntry[];
  deletedEntries: TerminalWorkspaceEntry[];
  unsupportedPaths: string[];
}

export interface RoomEntry {
  id: string;
  name: string;
  parentId: string | null;
  isFolder: boolean;
}
