import { describe, expect, it } from 'vitest';
import {
  getThemeBase,
  getThemeCssVariables,
  getThemeRules,
  getStoredThemeName,
} from '../themeUtils';

describe('theme utilities', () => {
  it('reads current and legacy saved theme formats safely', () => {
    expect(getStoredThemeName('Monokai')).toBe('Monokai');
    expect(getStoredThemeName('{"name":"Solarized Dark"}')).toBe(
      'Solarized Dark'
    );
    expect(getStoredThemeName('{"value":{"name":"Default Light+"}}')).toBe(
      'Default Light+'
    );
    expect(getStoredThemeName('{invalid')).toBe('{invalid');
  });

  it.each([
    ['dark', 'vs-dark'],
    ['light', 'vs'],
    ['hc', 'hc-black'],
    ['hcLight', 'hc-light'],
  ] as const)('maps %s to its Monaco base', (type, base) => {
    expect(getThemeBase(type)).toBe(base);
  });

  it('builds readable app colors from editor theme tokens', () => {
    expect(
      getThemeCssVariables({
        name: 'Test Light',
        type: 'light',
        colors: {
          'editor.background': '#fafafa',
          'editor.foreground': '#222222',
          focusBorder: '#0055aa',
          'scrollbarSlider.background': '#888888',
        },
      })
    ).toMatchObject({
      '--bg': '#fafafa',
      '--text': '#222222',
      '--app-bg': '#fafafa',
      '--border': '#d4d4d4',
      '--accent': '#0055aa',
      '--scrollbar-thumb': '#888888',
      '--scrollbar-thumb-active': 'rgba(0, 0, 0, 0.6)',
    });
  });

  it('converts textmate scopes and semantic token styles into Monaco rules', () => {
    expect(
      getThemeRules({
        name: 'Rules',
        tokenColors: [
          {
            scope: 'keyword, storage.type',
            settings: { foreground: '#123456', fontStyle: 'bold' },
          },
        ],
        semanticTokenColors: {
          'class:typescript': { foreground: '#abcdef', italic: true },
          function: '#fedcba',
          ignored: { bold: true },
        },
      })
    ).toEqual([
      { token: 'keyword', foreground: '123456', fontStyle: 'bold' },
      { token: 'storage.type', foreground: '123456', fontStyle: 'bold' },
      { token: 'class', foreground: 'abcdef', fontStyle: 'italic' },
      { token: 'function', foreground: 'fedcba', fontStyle: '' },
    ]);
  });
});
