export interface GithubRepositoryBaseline {
  owner: string;
  name: string;
  branch: string;
  baseCommitSha: string;
  baseTreeSha: string;
  isPrivate: boolean;
  fileBlobShas: Record<string, string>;
  fileLineEndings?: Record<string, 'lf' | 'crlf' | 'cr'>;
}

export interface GithubRepositoryFile {
  path: string;
  content: string;
  blobSha: string;
  size: number;
}

export interface GithubRepositoryImportResponse {
  baseline: GithubRepositoryBaseline;
  files: GithubRepositoryFile[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface GithubFileChange {
  path: string;
  content: string | null;
  deleted: boolean;
}

export interface GithubPushResponse {
  baseline: GithubRepositoryBaseline;
  branchUrl: string;
  compareUrl: string;
  commitSha: string;
}
