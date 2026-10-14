import { describe, expect, it } from 'vitest';
import { validateCodeForExecution } from '../codeValidation';

describe('validateCodeForExecution', () => {
  it('disables run when disconnected', () => {
    const result = validateCodeForExecution({
      code: 'print("hello")',
      language: 'python',
      filePath: 'main.py',
      isConnected: false,
    });
    expect(result.canRun).toBe(false);
    expect(result.reason).toContain('Connect to the room');
  });

  it('disables run for empty or whitespace-only code', () => {
    const result = validateCodeForExecution({
      code: '   \n\t  ',
      language: 'python',
      filePath: 'main.py',
      isConnected: true,
    });
    expect(result.canRun).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('disables run for JSX / TSX files requiring project build', () => {
    const result = validateCodeForExecution({
      code: 'export default function App() { return <div>Hello</div>; }',
      language: 'typescript',
      filePath: 'App.tsx',
      isConnected: true,
    });
    expect(result.canRun).toBe(false);
    expect(result.reason).toContain('project build');
  });

  it('disables run for HTML and CSS files', () => {
    const htmlResult = validateCodeForExecution({
      code: '<h1>Hello</h1>',
      language: 'html',
      filePath: 'index.html',
      isConnected: true,
    });
    expect(htmlResult.canRun).toBe(false);
    expect(htmlResult.reason).toContain('Preview');

    const cssResult = validateCodeForExecution({
      code: 'body { color: red; }',
      language: 'css',
      filePath: 'style.css',
      isConnected: true,
    });
    expect(cssResult.canRun).toBe(false);
  });

  it('disables run when native Monaco error markers are present', () => {
    const mockModel = {
      uri: { toString: () => 'inmemory://model/1' },
    } as any;

    const mockMonaco = {
      MarkerSeverity: { Error: 8 },
      editor: {
        getModelMarkers: () => [
          {
            severity: 8,
            message: 'Syntax error: Unexpected token',
            startLineNumber: 3,
          },
        ],
      },
    } as any;

    const result = validateCodeForExecution({
      code: 'const x = ;',
      language: 'javascript',
      filePath: 'index.js',
      isConnected: true,
      monacoApi: mockMonaco,
      model: mockModel,
    });

    expect(result.canRun).toBe(false);
    expect(result.reason).toContain('Syntax error on line 3');
  });

  it('enables run when code is valid and has no Monaco error markers', () => {
    const mockModel = {
      uri: { toString: () => 'inmemory://model/2' },
    } as any;

    const mockMonaco = {
      MarkerSeverity: { Error: 8 },
      editor: {
        getModelMarkers: () => [],
      },
    } as any;

    const result = validateCodeForExecution({
      code: 'console.log("hello");',
      language: 'javascript',
      filePath: 'index.js',
      isConnected: true,
      monacoApi: mockMonaco,
      model: mockModel,
    });

    expect(result.canRun).toBe(true);
  });
});
