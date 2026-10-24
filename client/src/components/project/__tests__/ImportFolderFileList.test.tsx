import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportFolderFileList } from '../ImportFolderFileList';

describe('ImportFolderFileList', () => {
  it('renders hostile file names as text', () => {
    const path = '<img src=x onerror=alert(1)>';
    const markup = renderToStaticMarkup(
      createElement(ImportFolderFileList, {
        candidates: [{ path, file: {} as File, size: 1, selected: true }],
        skipped: [],
        onToggle: () => undefined,
        disabled: false,
      })
    );

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img src=x');
  });
});
