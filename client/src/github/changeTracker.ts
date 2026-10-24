import type { RoomEntry } from '../providers/SignalRCrdtProvider';
import { getEntryPath } from '../components/editor/editorLayoutStorage';
import type { GithubFileChange, GithubRepositoryBaseline } from './githubTypes';

export interface GithubChangeStatus extends GithubFileChange {
  kind: 'added' | 'modified' | 'deleted';
}

export async function getGithubChanges(
  baseline: GithubRepositoryBaseline,
  entries: RoomEntry[],
  getContent: (fileId: string) => string
): Promise<GithubChangeStatus[]> {
  const currentFiles = new Map<string, string>();
  for (const entry of entries) {
    if (entry.isFolder) continue;
    const path = getEntryPath(entry, entries);
    if (path) currentFiles.set(path, entry.id);
  }

  const changes: GithubChangeStatus[] = [];
  for (const [path, blobSha] of Object.entries(baseline.fileBlobShas)) {
    const fileId = currentFiles.get(path);
    if (!fileId) {
      changes.push({ path, content: null, deleted: true, kind: 'deleted' });
      continue;
    }
    const content = preserveLineEndings(
      getContent(fileId),
      baseline.fileLineEndings?.[path] ?? 'lf'
    );
    if ((await getGitBlobSha(content)) !== blobSha.toLowerCase())
      changes.push({ path, content, deleted: false, kind: 'modified' });
    currentFiles.delete(path);
  }
  for (const [path, fileId] of currentFiles) {
    changes.push({
      path,
      content: getContent(fileId),
      deleted: false,
      kind: 'added',
    });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function preserveLineEndings(
  content: string,
  lineEnding: 'lf' | 'crlf' | 'cr'
): string {
  const newline = lineEnding === 'crlf' ? '\r\n' : lineEnding === 'cr' ? '\r' : '\n';
  return content.replace(/\r\n|\r|\n/g, newline);
}

async function getGitBlobSha(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header);
  blob.set(bytes, header.length);
  const digest = await crypto.subtle.digest('SHA-1', blob);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
