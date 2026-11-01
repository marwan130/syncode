import { useState } from 'react';

export function GithubRepositoryUrlForm({
  onOpenGithub,
  disabled,
}: {
  onOpenGithub: (repositoryUrl?: string) => void;
  disabled: boolean;
}) {
  const [repositoryUrl, setRepositoryUrl] = useState('');

  return (
    <form
      className="source-control-repository-url"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && repositoryUrl.trim())
          onOpenGithub(repositoryUrl.trim());
      }}
    >
      <input
        aria-label="GitHub repository URL"
        placeholder="https://github.com/owner/repository"
        value={repositoryUrl}
        disabled={disabled}
        onChange={(event) => setRepositoryUrl(event.currentTarget.value)}
      />
      <button type="submit" disabled={disabled || !repositoryUrl.trim()}>
        Review
      </button>
    </form>
  );
}
