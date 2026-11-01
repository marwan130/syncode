import type {
  RoomEntry,
  SignalRCrdtProvider,
} from '../../providers/SignalRCrdtProvider';
import { getEntryPath } from './editorLayoutStorage';

const MAX_SEARCH_MATCHES = 500;

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  preserveCase: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  isRegex: false,
  preserveCase: false,
};

export interface SearchMatch {
  fileId: string;
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchFileGroup {
  fileId: string;
  path: string;
  name: string;
  parentPath: string;
  matches: SearchMatch[];
}

function createSearchPattern(
  query: string,
  options: SearchOptions
): RegExp | null {
  const source = query.trim();
  if (!source) return null;
  try {
    const body = options.isRegex ? source : escapeRegExp(source);
    const wrapped = options.wholeWord ? `\\b(?:${body})\\b` : body;
    return new RegExp(wrapped, options.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function searchPatternError(
  query: string,
  options: SearchOptions
): string | null {
  if (!query.trim()) return null;
  return createSearchPattern(query, options)
    ? null
    : 'The search pattern is not valid.';
}

export function findWorkspaceMatches(
  entries: RoomEntry[],
  query: string,
  provider: SignalRCrdtProvider | null,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS
): SearchMatch[] {
  const pattern = createSearchPattern(query, options);
  if (!pattern || !provider) return [];
  const matches: SearchMatch[] = [];
  for (const entry of entries) {
    if (entry.isFolder) continue;
    const content = provider.getFileContent(entry.id);
    const lines = content.split('\n');
    const path = getEntryPath(entry, entries);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        matches.push({
          fileId: entry.id,
          path,
          line: index + 1,
          column: (match.index ?? 0) + 1,
          text: line.trim(),
        });
        if (matches.length >= MAX_SEARCH_MATCHES) return matches;
      }
    }
  }
  return matches;
}

export function replaceAllInText(
  content: string,
  query: string,
  replacement: string,
  options: SearchOptions
): string {
  const pattern = createSearchPattern(query, options);
  if (!pattern) return content;
  if (!options.preserveCase) return content.replace(pattern, replacement);
  return content.replace(pattern, (matched) =>
    preserveCase(matched, replacement)
  );
}

export function replaceMatchInText(
  content: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  lineNumber: number,
  column: number
): string {
  const lines = content.split('\n');
  const lineIndex = lineNumber - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return content;

  const line = lines[lineIndex];
  const pattern = createSearchPattern(query, options);
  if (!pattern) return content;

  pattern.lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex + 1 !== column) continue;

    const nextValue = options.preserveCase
      ? preserveCase(match[0], replacement)
      : replacement;
    lines[lineIndex] =
      line.slice(0, matchIndex) +
      nextValue +
      line.slice(matchIndex + match[0].length);
    return lines.join('\n');
  }

  lines[lineIndex] = replaceAllInText(line, query, replacement, options);
  return lines.join('\n');
}

export function groupSearchMatches(matches: SearchMatch[]): SearchFileGroup[] {
  const groups: SearchFileGroup[] = [];
  const indexByFile = new Map<string, SearchFileGroup>();
  for (const match of matches) {
    const existing = indexByFile.get(match.fileId);
    if (existing) {
      existing.matches.push(match);
      continue;
    }
    const slash = match.path.lastIndexOf('/');
    const group: SearchFileGroup = {
      fileId: match.fileId,
      path: match.path,
      name: slash >= 0 ? match.path.slice(slash + 1) : match.path,
      parentPath: slash >= 0 ? match.path.slice(0, slash) : '',
      matches: [match],
    };
    indexByFile.set(match.fileId, group);
    groups.push(group);
  }
  return groups;
}

export function highlightSearchLine(
  text: string,
  query: string,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS
): Array<{ text: string; match: boolean }> {
  const pattern = createSearchPattern(query, options);
  if (!pattern || !text) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor)
      parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: match[0], match: true });
    cursor = index + match[0].length;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function preserveCase(matched: string, replacement: string): string {
  if (!replacement) return replacement;
  if (matched === matched.toUpperCase()) return replacement.toUpperCase();
  if (matched === matched.toLowerCase()) return replacement.toLowerCase();
  return (
    replacement.slice(0, 1).toUpperCase() + replacement.slice(1).toLowerCase()
  );
}
