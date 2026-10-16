import type { Monaco } from '@monaco-editor/react';
import type * as MonacoTypes from 'monaco-editor';
import { getAutocompleteEnabled } from './autocompletePreference';
import type { LanguageMode } from '../components/editor/languageModes';

interface CompletionSnippet {
  label: string;
  insertText: string;
  detail: string;
}

interface LanguageCompletions {
  keywords: string[];
  snippets: CompletionSnippet[];
}

const COMPLETIONS: Record<LanguageMode, LanguageCompletions> = {
  html: {
    keywords: [
      'doctype',
      'html',
      'head',
      'body',
      'main',
      'section',
      'div',
      'script',
      'link',
    ],
    snippets: [
      {
        label: 'HTML document',
        insertText:
          '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${1:Document}</title>\n</head>\n<body>\n  ${0}\n</body>\n</html>',
        detail: 'HTML page structure',
      },
      {
        label: 'script element',
        insertText: '<script src="${1:script.js}" defer></script>',
        detail: 'Load a JavaScript file',
      },
      {
        label: 'stylesheet link',
        insertText: '<link rel="stylesheet" href="${1:style.css}">',
        detail: 'Load a CSS file',
      },
    ],
  },
  css: {
    keywords: [
      'display',
      'flex',
      'grid',
      'position',
      'margin',
      'padding',
      'color',
      'background',
      'font-size',
      'width',
      'height',
    ],
    snippets: [
      {
        label: 'flex center',
        insertText:
          'display: flex;\njustify-content: center;\nalign-items: center;',
        detail: 'Center content with flexbox',
      },
      {
        label: 'media query',
        insertText: '@media (${1:max-width: 600px}) {\n  ${0}\n}',
        detail: 'Responsive media query',
      },
    ],
  },
  javascript: {
    keywords: [
      'const',
      'let',
      'function',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'async',
      'await',
      'import',
      'export',
      'try',
      'catch',
    ],
    snippets: [
      {
        label: 'function',
        insertText: 'function ${1:name}(${2:params}) {\n  ${0}\n}',
        detail: 'Function declaration',
      },
      {
        label: 'arrow function',
        insertText: 'const ${1:name} = (${2:params}) => {\n  ${0}\n};',
        detail: 'Arrow function',
      },
      {
        label: 'console.log',
        insertText: 'console.log(${1:value});',
        detail: 'Log a value',
      },
    ],
  },
  typescript: {
    keywords: [
      'const',
      'let',
      'function',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'async',
      'await',
      'import',
      'export',
      'interface',
      'type',
      'enum',
      'implements',
      'readonly',
    ],
    snippets: [
      {
        label: 'interface',
        insertText: 'interface ${1:Name} {\n  ${0}\n}',
        detail: 'Interface declaration',
      },
      {
        label: 'typed function',
        insertText: 'function ${1:name}(${2:params}): ${3:void} {\n  ${0}\n}',
        detail: 'Typed function declaration',
      },
      {
        label: 'arrow function',
        insertText:
          'const ${1:name} = (${2:params}): ${3:void} => {\n  ${0}\n};',
        detail: 'Typed arrow function',
      },
    ],
  },
  python: {
    keywords: [
      'def',
      'class',
      'return',
      'if',
      'elif',
      'else',
      'for',
      'while',
      'in',
      'try',
      'except',
      'with',
      'as',
      'import',
      'from',
      'async',
      'await',
      'yield',
      'lambda',
    ],
    snippets: [
      {
        label: 'function',
        insertText: 'def ${1:name}(${2:params}):\n    ${0:pass}',
        detail: 'Function definition',
      },
      {
        label: 'main guard',
        insertText: 'if __name__ == "__main__":\n    ${0}',
        detail: 'Script entry point',
      },
      {
        label: 'for loop',
        insertText: 'for ${1:item} in ${2:items}:\n    ${0}',
        detail: 'For loop',
      },
    ],
  },
  csharp: {
    keywords: [
      'using',
      'namespace',
      'class',
      'public',
      'private',
      'static',
      'void',
      'string',
      'int',
      'var',
      'return',
      'if',
      'else',
      'foreach',
      'async',
      'await',
      'new',
    ],
    snippets: [
      {
        label: 'class',
        insertText: 'public class ${1:ClassName}\n{\n    ${0}\n}',
        detail: 'Class declaration',
      },
      {
        label: 'main method',
        insertText: 'static void Main(string[] args)\n{\n    ${0}\n}',
        detail: 'Program entry point',
      },
      {
        label: 'property',
        insertText: 'public ${1:string} ${2:Name} { get; set; }',
        detail: 'Auto property',
      },
    ],
  },
  c: {
    keywords: [
      '#include',
      '#define',
      'int',
      'char',
      'float',
      'double',
      'void',
      'struct',
      'typedef',
      'return',
      'if',
      'else',
      'for',
      'while',
      'switch',
      'case',
      'const',
      'static',
    ],
    snippets: [
      {
        label: 'main function',
        insertText: 'int main(void) {\n    ${0}\n    return 0;\n}',
        detail: 'C program entry point',
      },
      {
        label: 'printf',
        insertText: 'printf("${1:%s}\\n", ${2:value});',
        detail: 'Print formatted output',
      },
      {
        label: 'include stdio',
        insertText: '#include <stdio.h>',
        detail: 'Include standard I/O',
      },
    ],
  },
  cpp: {
    keywords: [
      '#include',
      'using',
      'namespace',
      'int',
      'char',
      'float',
      'double',
      'void',
      'class',
      'struct',
      'return',
      'if',
      'else',
      'for',
      'while',
      'switch',
      'template',
      'const',
      'auto',
      'new',
      'delete',
    ],
    snippets: [
      {
        label: 'main function',
        insertText: 'int main() {\n    ${0}\n    return 0;\n}',
        detail: 'C++ program entry point',
      },
      {
        label: 'include iostream',
        insertText: '#include <iostream>',
        detail: 'Include standard I/O',
      },
      {
        label: 'cout',
        insertText: 'std::cout << ${1:value} << std::endl;',
        detail: 'Write to standard output',
      },
    ],
  },
  rust: {
    keywords: [
      'fn',
      'let',
      'mut',
      'const',
      'static',
      'pub',
      'struct',
      'enum',
      'impl',
      'trait',
      'use',
      'mod',
      'match',
      'if',
      'else',
      'loop',
      'while',
      'for',
      'in',
      'return',
      'async',
      'await',
      'move',
    ],
    snippets: [
      {
        label: 'main function',
        insertText: 'fn main() {\n    ${0}\n}',
        detail: 'Rust program entry point',
      },
      {
        label: 'function',
        insertText: 'fn ${1:name}(${2:params}) -> ${3:()} {\n    ${0}\n}',
        detail: 'Function definition',
      },
      {
        label: 'println',
        insertText: 'println!("${1:{}}", ${2:value});',
        detail: 'Print formatted output',
      },
    ],
  },
  java: {
    keywords: [
      'package',
      'import',
      'class',
      'interface',
      'enum',
      'public',
      'private',
      'protected',
      'static',
      'final',
      'void',
      'int',
      'String',
      'return',
      'if',
      'else',
      'for',
      'while',
      'new',
      'extends',
      'implements',
      'try',
      'catch',
    ],
    snippets: [
      {
        label: 'main method',
        insertText: 'public static void main(String[] args) {\n    ${0}\n}',
        detail: 'Java program entry point',
      },
      {
        label: 'class',
        insertText: 'public class ${1:ClassName} {\n    ${0}\n}',
        detail: 'Class declaration',
      },
      {
        label: 'System.out.println',
        insertText: 'System.out.println(${1:value});',
        detail: 'Print a line',
      },
    ],
  },
};

const configuredMonacoInstances = new WeakSet<object>();

export function configureMonacoCompletions(monaco: Monaco): void {
  if (configuredMonacoInstances.has(monaco)) return;
  configuredMonacoInstances.add(monaco);

  for (const [language, completions] of Object.entries(COMPLETIONS) as [
    LanguageMode,
    LanguageCompletions,
  ][]) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '#'],
      provideCompletionItems(
        model: MonacoTypes.editor.ITextModel,
        position: MonacoTypes.Position
      ) {
        if (!getAutocompleteEnabled()) return { suggestions: [] };

        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );
        const prefix = word.word.toLowerCase();
        const keywords = completions.keywords
          .filter(
            (keyword) => !prefix || keyword.toLowerCase().startsWith(prefix)
          )
          .map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            range,
          }));
        const snippets = completions.snippets
          .filter(
            (snippet) => !prefix || snippet.label.toLowerCase().includes(prefix)
          )
          .map((snippet) => ({
            ...snippet,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          }));

        return { suggestions: [...keywords, ...snippets] };
      },
    });
  }
}
