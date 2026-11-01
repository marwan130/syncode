import { describe, expect, it } from 'vitest';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { SignalRCrdtProvider } from '../../providers/SignalRCrdtProvider';
import { connectModelToLanguageServer } from '../monacoLanguageServers';

describe('Monaco language server selection', () => {
  it('uses Monaco diagnostics for CSS without starting a language server', async () => {
    const release = await connectModelToLanguageServer(
      {} as Monaco,
      {} as SignalRCrdtProvider,
      'css',
      {} as monaco.editor.ITextModel,
      'styles',
      'styles.css'
    );

    expect(release).toBeTypeOf('function');
  });
});
