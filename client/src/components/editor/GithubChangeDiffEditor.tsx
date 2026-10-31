import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { GithubChangeReviewTab } from '../../github/changeTracker';
import { getGithubFileContent } from '../../github/repositoryBrowser';
import { languageForFileName } from './languageModes';
import { userFacingError } from '../../utils/userFacingError';

export function GithubChangeDiffEditor({
  tab,
}: {
  tab: GithubChangeReviewTab;
}) {
  const sha = tab.baseline.fileBlobShas[tab.change.path];
  const requestKey = `${tab.baseline.owner}/${tab.baseline.name}/${tab.baseline.baseCommitSha}/${tab.change.path}`;
  const [loadedContent, setLoadedContent] = useState<{
    requestKey: string;
    original: string;
    error: string;
  } | null>(null);
  const currentContent =
    loadedContent?.requestKey === requestKey ? loadedContent : null;
  const loading = Boolean(sha && !currentContent);
  const original = currentContent?.original ?? '';
  const error = currentContent?.error ?? '';

  useEffect(() => {
    if (!sha) return;
    let active = true;
    void getGithubFileContent(tab.baseline.owner, tab.baseline.name, sha)
      .then((content) => {
        if (active)
          setLoadedContent({ requestKey, original: content, error: '' });
      })
      .catch((reason: unknown) => {
        if (active)
          setLoadedContent({
            requestKey,
            original: '',
            error: userFacingError(
              reason,
              'Could not load the repository version.'
            ),
          });
      });
    return () => {
      active = false;
    };
  }, [requestKey, sha, tab.baseline.name, tab.baseline.owner]);

  return (
    <div
      className="editor-change-diff"
      aria-label={`Changes in ${tab.change.path}`}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading repository version…</p>
      ) : (
        <DiffEditor
          height="100%"
          language={languageForFileName(tab.change.path)}
          originalModelPath={createDiffModelPath(
            'github',
            `${tab.baseline.owner}-${tab.baseline.name}-${tab.baseline.baseCommitSha}`,
            tab.change.path
          )}
          modifiedModelPath={createDiffModelPath(
            'syncode',
            tab.id,
            tab.change.path
          )}
          theme="syncode-current-theme"
          original={original}
          modified={tab.change.content ?? ''}
          options={{
            automaticLayout: true,
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            overviewRulerLanes: 0,
            scrollBeyondLastLine: false,
            scrollbar: {
              verticalScrollbarSize: 14,
              horizontalScrollbarSize: 14,
              useShadows: false,
            },
          }}
        />
      )}
    </div>
  );
}

function createDiffModelPath(scheme: string, authority: string, path: string) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${scheme}://${encodeURIComponent(authority)}/${encodedPath}`;
}
