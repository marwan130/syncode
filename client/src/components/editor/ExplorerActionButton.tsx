import type { FC, ReactNode } from 'react';

export type ExplorerActionKind =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'delete'
  | 'import-folder'
  | 'save-project';

export interface ExplorerActionButtonProps {
  kind: ExplorerActionKind;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

const PATHS: Record<ExplorerActionKind, ReactNode> = {
  'new-file': (
    <>
      <path d="M9 2.75H4.5a1.75 1.75 0 0 0-1.75 1.75v11A1.75 1.75 0 0 0 4.5 17.25h7A1.75 1.75 0 0 0 13.25 15.5V7z" />
      <path d="M9 2.75V7h4.25M16.5 11.5v7m-3.5-3.5h7" />
    </>
  ),
  'new-folder': (
    <>
      <path d="M2.75 5A1.75 1.75 0 0 1 4.5 3.25h4l1.75 2h5.25A1.75 1.75 0 0 1 17.25 7v7.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M10 8.5v6m-3-3h6" />
    </>
  ),
  'import-folder': (
    <>
      <path d="M2.75 5A1.75 1.75 0 0 1 4.5 3.25h4l1.75 2h5.25A1.75 1.75 0 0 1 17.25 7v7.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M10 13V7m-2 2 2-2 2 2" />
    </>
  ),
  'save-project': (
    <>
      <path d="M2.75 5A1.75 1.75 0 0 1 4.5 3.25h4l1.75 2h5.25A1.75 1.75 0 0 1 17.25 7v7.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M10 7v6m-2-2 2 2 2-2" />
    </>
  ),
  rename: (
    <>
      <path d="m3 13.5-.75 4.25L6.5 17l9.9-9.9a2.12 2.12 0 0 0-3-3z" />
      <path d="m11.75 5.75 3 3" />
    </>
  ),
  delete: (
    <>
      <path d="M3.5 5.5h13M6 5.5l.7 11h6.6l.7-11M7.5 5.5V3.75h5V5.5m-3.5 3v5m2-5v5" />
    </>
  ),
};

export const ExplorerActionButton: FC<ExplorerActionButtonProps> = ({
  kind,
  label,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    className="file-explorer-action"
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
  >
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[kind]}
    </svg>
  </button>
);
