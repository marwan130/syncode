import type { Monaco } from '@monaco-editor/react';

let isConfigured = false;

/**
 * Configures Monaco's built-in language services to enable full type checking,
 * syntax error detection, and error decorations 
 */
export function configureMonacoDiagnostics(monaco: Monaco): void {
  if (isConfigured) return;
  isConfigured = true;

  const ts = monaco.languages.typescript;
  if (ts) {
    const diagnosticOptions = {
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
    };

    ts.typescriptDefaults.setDiagnosticsOptions(diagnosticOptions);
    ts.javascriptDefaults.setDiagnosticsOptions(diagnosticOptions);

    ts.typescriptDefaults.setEagerModelSync(true);
    ts.javascriptDefaults.setEagerModelSync(true);

    const compilerOptions = {
      target: ts.ScriptTarget.ESNext,
      allowNonTextFiles: false,
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.ESNext,
      lib: ['esnext', 'dom'],
      strict: true,
      alwaysStrict: true,
      noEmit: true,
      skipLibCheck: true,
    };

    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    ts.javascriptDefaults.setCompilerOptions(compilerOptions);
  }

  if (monaco.languages.json?.jsonDefaults) {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
    });
  }

  if (monaco.languages.css?.cssDefaults) {
    monaco.languages.css.cssDefaults.setDiagnosticsOptions({
      validate: true,
    });
  }
}
