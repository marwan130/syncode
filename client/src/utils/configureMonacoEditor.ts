import type { Monaco } from '@monaco-editor/react';
import { configureMonacoCompletions } from './monacoCompletions';
import { configureMonacoDiagnostics } from './monacoDiagnostics';

export function configureMonacoEditor(monaco: Monaco): void {
  configureMonacoDiagnostics(monaco);
  configureMonacoCompletions(monaco);
}
