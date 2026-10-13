import type { editor as MonacoEditor } from 'monaco-editor';

interface SearchReplaceProps {
  editor: MonacoEditor.IStandaloneCodeEditor | null;
}

export function SearchReplace({ editor }: SearchReplaceProps) {
  return (
    <div className="search-replace-actions">
      <button
        type="button"
        className="search-replace-button"
        aria-label="Find in file"
        title="Find (Ctrl+F)"
        disabled={!editor}
        onClick={() => {
          void editor?.getAction('actions.find')?.run();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      </button>
      <button
        type="button"
        className="search-replace-button"
        aria-label="Find and replace in file"
        title="Find and replace"
        disabled={!editor}
        onClick={() => {
          void editor?.getAction('editor.action.startFindReplaceAction')?.run();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h15l-3-3" />
          <path d="M20 17H5l3 3" />
        </svg>
      </button>
    </div>
  );
}
