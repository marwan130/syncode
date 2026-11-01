import { describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import { configureMonacoDiagnostics } from '../monacoDiagnostics';

describe('Monaco diagnostics configuration', () => {
  it('enables CSS validation', () => {
    const setCssDiagnosticsOptions = vi.fn();
    const monaco = {
      languages: {
        css: {
          cssDefaults: { setDiagnosticsOptions: setCssDiagnosticsOptions },
        },
      },
    } as unknown as Monaco;

    configureMonacoDiagnostics(monaco);

    expect(setCssDiagnosticsOptions).toHaveBeenCalledWith({ validate: true });
  });
});
