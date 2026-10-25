import { describe, expect, it } from 'vitest';
import type { PreviewProject } from '../../../hooks/useDebouncedPreview';
import { createPreviewDocument, resolveRoomPath } from '../previewDocument';

function project(
  files: PreviewProject['files'],
  activeFilePath = 'index.html',
  source = ''
): PreviewProject {
  return { activeFilePath, source, files };
}

describe('preview document assembly', () => {
  it('resolves relative and root paths without escaping the room tree', () => {
    expect(resolveRoomPath('src/pages/index.html', '../styles/site.css')).toBe(
      'src/styles/site.css'
    );
    expect(resolveRoomPath('src/index.html', '/styles/site.css')).toBe(
      'styles/site.css'
    );
    expect(resolveRoomPath('index.html', '../../../outside.js')).toBe(
      'outside.js'
    );
  });

  it('inlines room CSS and JavaScript while keeping remote references untouched', () => {
    const html = createPreviewDocument(
      project([
        {
          path: 'index.html',
          content:
            '<html><head></head><body><link rel="stylesheet" href="style.css"><script src="script.js"></script><script src="https://example.com/app.js"></script></body></html>',
        },
        { path: 'style.css', content: 'body { color: red; }' },
        { path: 'script.js', content: 'window.previewLoaded = true;' },
      ]),
      'html',
      undefined,
      2
    );

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('<style>body { color: red; }</style>');
    expect(html).toContain('<script>window.previewLoaded = true;</script>');
    expect(html).toContain('<script src="https://example.com/app.js"></script>');
    expect(html).toContain('tabId=2');
  });

  it('uses the active TypeScript output when its linked script is opened', () => {
    const html = createPreviewDocument(
      project(
        [
          {
            path: 'app/index.html',
            content: '<script src="main.ts"></script>',
          },
          { path: 'app/main.ts', content: 'const oldOutput = true;' },
        ],
        'app/main.ts'
      ),
      'typescript',
      'const currentOutput = true;',
      1
    );

    expect(html).toContain('const currentOutput = true;');
    expect(html).not.toContain('const oldOutput = true;');
  });

  it('builds standalone JavaScript and CSS documents with closing tags escaped', () => {
    const scriptDocument = createPreviewDocument(
      project([], 'main.js', 'const text = "</script>";'),
      'javascript',
      undefined,
      1
    );
    const cssDocument = createPreviewDocument(
      project([], 'main.css', '.box { color: red; }</style>'),
      'css',
      undefined,
      1
    );

    expect(scriptDocument).toContain('const text = "<\\/script>";');
    expect(scriptDocument).toContain('<\\/script>');
    expect(cssDocument).toContain('.box { color: red; }<\\/style>');
  });
});
