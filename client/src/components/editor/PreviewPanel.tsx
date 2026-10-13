import type { FC } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { LivePreview } from './LivePreview';
import { ResizeHandle } from './ResizeHandle';
import {
  DEFAULT_PREVIEW_WIDTH,
  PREVIEW_CLOSE_THRESHOLD,
  storePreviewWidth,
} from './editorLayoutStorage';
import { isPreviewLanguage, type LanguageMode } from './languageModes';
import type { PreviewProject } from '../../hooks/useDebouncedPreview';

interface PreviewPanelProps {
  isOpen: boolean;
  width: number;
  hasActiveFile: boolean;
  language: LanguageMode;
  project: PreviewProject | null;
  monaco: Monaco | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}

export const PreviewPanel: FC<PreviewPanelProps> = ({
  isOpen,
  width,
  hasActiveFile,
  language,
  project,
  monaco: monacoApi,
  editor,
  onWidthChange,
  onClose,
}) => {
  if (!isOpen || !hasActiveFile || !isPreviewLanguage(language) || !project)
    return null;

  return (
    <>
      <ResizeHandle
        label="Resize live preview"
        reverse
        onResize={(delta) => {
          const nextWidth = Math.min(1000, width + delta);
          if (nextWidth <= PREVIEW_CLOSE_THRESHOLD) {
            onClose();
            onWidthChange(DEFAULT_PREVIEW_WIDTH);
            storePreviewWidth(DEFAULT_PREVIEW_WIDTH);
            return;
          }
          onWidthChange(nextWidth);
          storePreviewWidth(nextWidth);
        }}
      />
      <LivePreview
        project={project}
        language={language}
        monaco={monacoApi}
        editor={editor}
        style={{ flex: `0 0 ${width}px` }}
      />
    </>
  );
};
