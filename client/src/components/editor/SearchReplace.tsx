import type { CSSProperties } from 'react';
import type { editor as MonacoEditor } from 'monaco-editor';

interface SearchReplaceProps {
  editor: MonacoEditor.IStandaloneCodeEditor | null;
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  color: 'var(--text-muted)',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
};

export function SearchReplace({ editor }: SearchReplaceProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        aria-label="Find in file"
        title="Find (Ctrl+F)"
        disabled={!editor}
        onClick={() => {
          void editor?.getAction('actions.find')?.run();
        }}
        style={{ ...buttonStyle, opacity: editor ? 1 : 0.5 }}
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
        aria-label="Find and replace in file"
        title="Find and replace"
        disabled={!editor}
        onClick={() => {
          void editor?.getAction('editor.action.startFindReplaceAction')?.run();
        }}
        style={{ ...buttonStyle, opacity: editor ? 1 : 0.5 }}
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
