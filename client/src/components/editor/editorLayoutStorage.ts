import type { RoomEntry } from '../../providers/SignalRCrdtProvider';

const PREVIEW_WIDTH_KEY = 'syncode_live_preview_width';
const TERMINAL_HEIGHT_KEY = 'syncode_terminal_height';
const EXPLORER_WIDTH_KEY = 'syncode_explorer_width';

export const DEFAULT_PREVIEW_WIDTH = 420;
export const DEFAULT_TERMINAL_HEIGHT = 240;
export const DEFAULT_EXPLORER_WIDTH = 220;
export const DEFAULT_CHAT_WIDTH = 300;
export const MIN_PREVIEW_WIDTH = 16;
export const MIN_SIDE_PANEL_WIDTH = 130;
export const MIN_CHAT_WIDTH = 180;
export const MIN_TERMINAL_HEIGHT = 100;

export function getStoredTerminalHeight(): number {
  try {
    const value = Number(localStorage.getItem(TERMINAL_HEIGHT_KEY));
    return Number.isFinite(value) && value >= MIN_TERMINAL_HEIGHT
      ? Math.min(700, value)
      : DEFAULT_TERMINAL_HEIGHT;
  } catch {
    return DEFAULT_TERMINAL_HEIGHT;
  }
}

export function storeTerminalHeight(value: number): void {
  try {
    localStorage.setItem(TERMINAL_HEIGHT_KEY, String(value));
  } catch {
    return;
  }
}

export function getStoredExplorerWidth(): number {
  try {
    const value = Number(localStorage.getItem(EXPLORER_WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_SIDE_PANEL_WIDTH
      ? Math.min(600, value)
      : DEFAULT_EXPLORER_WIDTH;
  } catch {
    return DEFAULT_EXPLORER_WIDTH;
  }
}

export function storeExplorerWidth(value: number): void {
  try {
    localStorage.setItem(EXPLORER_WIDTH_KEY, String(value));
  } catch {
    return;
  }
}

export function getStoredActiveFileId(roomId: string): string | null {
  try {
    return sessionStorage.getItem(`syncode_active_file:${roomId}`);
  } catch {
    return null;
  }
}

export function storeActiveFileId(roomId: string, fileId: string): void {
  try {
    sessionStorage.setItem(`syncode_active_file:${roomId}`, fileId);
  } catch {
    return;
  }
}

export function getStoredPreviewWidth(): number {
  try {
    const width = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(width) && width >= MIN_PREVIEW_WIDTH
      ? Math.min(1000, width)
      : DEFAULT_PREVIEW_WIDTH;
  } catch {
    return DEFAULT_PREVIEW_WIDTH;
  }
}

export function storePreviewWidth(width: number): void {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
  } catch {
    return;
  }
}

export function getEntryPath(entry: RoomEntry, entries: RoomEntry[]): string {
  const path = [entry.name];
  let parentId = entry.parentId;
  while (parentId) {
    const parent = entries.find(
      (item) => item.id === parentId && item.isFolder
    );
    if (!parent) break;
    path.unshift(parent.name);
    parentId = parent.parentId;
  }
  return path.join('/');
}
