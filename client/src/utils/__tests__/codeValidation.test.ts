import { describe, expect, it, vi } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { validateCodeForExecution } from '../codeValidation';

const baseOptions = {
  code: 'console.log(1)',
  language: 'javascript' as const,
  filePath: 'src/main.js',
  isConnected: true,
};

describe('validateCodeForExecution', () => {
  it('allows nonempty supported source when connected', () => {
    expect(validateCodeForExecution(baseOptions)).toEqual({ canRun: true });
  });

  it('requires a connected room and nonempty source', () => {
    expect(
      validateCodeForExecution({ ...baseOptions, isConnected: false })
    ).toEqual({ canRun: false, reason: 'Connect to the room to run code' });
    expect(validateCodeForExecution({ ...baseOptions, code: '  ' })).toEqual({
      canRun: false,
      reason: 'Cannot run empty code',
    });
  });

  it.each(['jsx', 'tsx'])(
    'rejects .%s as a single runnable file',
    (extension) => {
      expect(
        validateCodeForExecution({
          ...baseOptions,
          filePath: `src/App.${extension}`,
        }).canRun
      ).toBe(false);
    }
  );

  it.each(['html', 'css'])('routes %s to the preview', (language) => {
    expect(
      validateCodeForExecution({
        ...baseOptions,
        language: language as 'html' | 'css',
      }).reason
    ).toBe('HTML and CSS cannot be run directly. Use the Preview panel.');
  });

  it('rejects unsupported execution languages', () => {
    expect(
      validateCodeForExecution({
        ...baseOptions,
        language: 'html',
        filePath: 'page.html',
      }).canRun
    ).toBe(false);
  });

  it('blocks execution when Monaco reports a syntax error', () => {
    const getModelMarkers = vi.fn(() => [
      { severity: 8, startLineNumber: 3, message: 'Unexpected token' },
    ]);
    const monacoApi = {
      MarkerSeverity: { Error: 8 },
      editor: { getModelMarkers },
    } as unknown as Monaco;
    const model = {
      uri: 'file:///src/main.js',
    } as unknown as monaco.editor.ITextModel;

    expect(
      validateCodeForExecution({ ...baseOptions, monacoApi, model })
    ).toEqual({
      canRun: false,
      reason: 'Syntax error on line 3: Unexpected token',
    });
    expect(getModelMarkers).toHaveBeenCalledWith({ resource: model.uri });
  });
});
