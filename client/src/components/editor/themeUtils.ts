import type { Monaco } from '@monaco-editor/react';

export interface VscodeTheme {
  name: string;
  type?: 'dark' | 'light' | 'hc' | 'hcLight';
  colors?: Record<string, string>;
  tokenColors?: Array<{
    scope?: string | string[];
    settings?: { foreground?: string; fontStyle?: string };
  }>;
  semanticTokenColors?: Record<
    string,
    | string
    | {
        foreground?: string;
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
      }
  >;
}

export interface ThemeEntry {
  name: string;
  value: VscodeTheme;
}

export function getThemeBase(type?: VscodeTheme['type']) {
  const normalized = type?.toLowerCase();
  if (normalized === 'hc') return 'hc-black';
  if (normalized === 'hclight') return 'hc-light';
  if (normalized === 'light') return 'vs';
  return 'vs-dark';
}

export function getStoredThemeName(stored: string) {
  const parsed = parseStoredTheme(stored);
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return stored;
  const value = parsed as { name?: unknown; value?: { name?: unknown } };
  if (typeof value.name === 'string') return value.name;
  if (typeof value.value?.name === 'string') return value.value.name;
  return stored;
}

function parseStoredTheme(stored: string): unknown {
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return null;
  }
}

export function getThemeCssVariables(theme: VscodeTheme) {
  const colors = theme.colors ?? {};
  const get = (key: string, fallback: string) => colors[key] ?? fallback;
  const foreground = get('editor.foreground', '#d4d4d4');
  const isLightTheme = theme.type?.toLowerCase().includes('light') ?? false;
  const fallbackText = theme.type === 'light' ? '#666666' : '#9ca3af';
  return {
    '--app-bg': get(
      'titleBar.activeBackground',
      get('sideBar.background', get('editor.background', '#1e1e1e'))
    ),
    '--surface-bg': get(
      'panel.background',
      get('sideBar.background', get('editor.background', '#1e1e1e'))
    ),
    '--control-bg': get(
      'input.background',
      get('editor.background', '#1e1e1e')
    ),
    '--input-fg': get('input.foreground', foreground),
    '--input-placeholder': get(
      'input.placeholderForeground',
      get('descriptionForeground', fallbackText)
    ),
    '--bg': get('editor.background', '#1e1e1e'),
    '--code-bg': get('editor.background', '#1e1e1e'),
    '--text': foreground,
    '--text-h': foreground,
    '--text-muted': get('descriptionForeground', fallbackText),
    '--border': get(
      'sideBar.border',
      theme.type === 'light' ? '#d4d4d4' : '#3c3c3c'
    ),
    '--accent': get('focusBorder', '#38bdf8'),
    '--button-bg': get('button.background', get('focusBorder', '#0284c7')),
    '--button-fg': get('button.foreground', '#ffffff'),
    '--accent-bg': `${get('focusBorder', '#38bdf8')}22`,
    '--accent-border': get('focusBorder', '#38bdf8'),
    '--danger': get('errorForeground', '#ef4444'),
    '--warning': get(
      'editorWarning.foreground',
      get('editorWarning.border', '#d7ba7d')
    ),
    '--success': get('testing.iconPassed', get('charts.green', '#89d185')),
    '--scrollbar-track': get('scrollbar.background', 'transparent'),
    '--scrollbar-thumb': get(
      'scrollbarSlider.background',
      isLightTheme ? 'rgba(100, 100, 100, 0.4)' : 'rgba(121, 121, 121, 0.4)'
    ),
    '--scrollbar-thumb-hover': get(
      'scrollbarSlider.hoverBackground',
      'rgba(100, 100, 100, 0.7)'
    ),
    '--scrollbar-thumb-active': get(
      'scrollbarSlider.activeBackground',
      isLightTheme ? 'rgba(0, 0, 0, 0.6)' : 'rgba(191, 191, 191, 0.4)'
    ),
  } satisfies Record<string, string>;
}

export function getThemeRules(theme: VscodeTheme) {
  return [...getTextMateRules(theme), ...getSemanticTokenRules(theme)];
}

function getTextMateRules(theme: VscodeTheme) {
  return (theme.tokenColors ?? []).flatMap((token) => {
    if (!token.settings) return [];
    return getTokenScopes(token.scope).map((scope) => ({
      token: scope,
      foreground: token.settings?.foreground?.replace('#', ''),
      fontStyle: token.settings?.fontStyle,
    }));
  });
}

function getTokenScopes(scope?: string | string[]) {
  if (Array.isArray(scope)) return scope;
  return (scope ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSemanticTokenRules(theme: VscodeTheme) {
  return Object.entries(theme.semanticTokenColors ?? {}).flatMap(
    ([token, style]) => {
      const settings =
        typeof style === 'string' ? { foreground: style } : style;
      if (!settings.foreground) return [];
      return [
        {
          token: token.replace(/:[\w.-]+/g, ''),
          foreground: settings.foreground.replace('#', ''),
          fontStyle: getSemanticFontStyle(settings),
        },
      ];
    }
  );
}

function getSemanticFontStyle(settings: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return [
    settings.bold && 'bold',
    settings.italic && 'italic',
    settings.underline && 'underline',
  ]
    .filter(Boolean)
    .join(' ');
}

interface BuiltInPalette {
  background: string;
  foreground: string;
  sidebar: string;
  control: string;
  accent: string;
  comment: string;
  keyword: string;
  string: string;
  function: string;
  number: string;
}

function builtInTheme(
  name: string,
  type: 'dark' | 'light',
  palette: BuiltInPalette
): ThemeEntry {
  return {
    name,
    value: {
      name,
      type,
      colors: {
        'editor.background': palette.background,
        'editor.foreground': palette.foreground,
        'sideBar.background': palette.sidebar,
        'panel.background': palette.sidebar,
        'input.background': palette.control,
        'activityBar.background': palette.sidebar,
        focusBorder: palette.accent,
      },
      tokenColors: [
        { scope: ['comment'], settings: { foreground: palette.comment } },
        { scope: ['keyword'], settings: { foreground: palette.keyword } },
        { scope: ['string'], settings: { foreground: palette.string } },
        {
          scope: ['entity.name.function'],
          settings: { foreground: palette.function },
        },
        {
          scope: ['constant.numeric'],
          settings: { foreground: palette.number },
        },
      ],
    },
  };
}

export const BUILT_IN_THEMES: ThemeEntry[] = [
  builtInTheme('Default Dark+', 'dark', {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    sidebar: '#181818',
    control: '#252526',
    accent: '#007acc',
    comment: '#6a9955',
    keyword: '#569cd6',
    string: '#ce9178',
    function: '#dcdcaa',
    number: '#b5cea8',
  }),
  builtInTheme('Default Light+', 'light', {
    background: '#f3f3f3',
    foreground: '#333333',
    sidebar: '#e8e8e8',
    control: '#ededed',
    accent: '#0078d4',
    comment: '#008000',
    keyword: '#0000aa',
    string: '#a31515',
    function: '#795e26',
    number: '#098658',
  }),
  builtInTheme('Monokai', 'dark', {
    background: '#272822',
    foreground: '#f8f8f2',
    sidebar: '#20211c',
    control: '#34352f',
    accent: '#a6e22e',
    comment: '#75715e',
    keyword: '#f92672',
    string: '#e6db74',
    function: '#a6e22e',
    number: '#e6db74',
  }),
  builtInTheme('Solarized Dark', 'dark', {
    background: '#002b36',
    foreground: '#839496',
    sidebar: '#073642',
    control: '#073642',
    accent: '#268bd2',
    comment: '#586e75',
    keyword: '#859900',
    string: '#2aa198',
    function: '#b58900',
    number: '#cb4b16',
  }),
  builtInTheme('Solarized Light', 'light', {
    background: '#fdf6e3',
    foreground: '#586e75',
    sidebar: '#eee8d5',
    control: '#eee8d5',
    accent: '#268bd2',
    comment: '#93a1a1',
    keyword: '#859900',
    string: '#2aa198',
    function: '#b58900',
    number: '#cb4b16',
  }),
  builtInTheme('GitHub Light', 'light', {
    background: '#f6f8fa',
    foreground: '#24292f',
    sidebar: '#eaeef2',
    control: '#f0f2f4',
    accent: '#0969da',
    comment: '#6e7781',
    keyword: '#cf222e',
    string: '#0a3069',
    function: '#0550ae',
    number: '#0550ae',
  }),
  builtInTheme('Tomorrow Night', 'dark', {
    background: '#1d1f21',
    foreground: '#c5c8c6',
    sidebar: '#282a2e',
    control: '#373b41',
    accent: '#81a2be',
    comment: '#969896',
    keyword: '#81a2be',
    string: '#b5bd68',
    function: '#de935f',
    number: '#cc6666',
  }),
  builtInTheme('High Contrast', 'dark', {
    background: '#171b22',
    foreground: '#f0f0f0',
    sidebar: '#11161d',
    control: '#242a33',
    accent: '#f2c94c',
    comment: '#b3bdc9',
    keyword: '#f2c94c',
    string: '#7ee787',
    function: '#79c0ff',
    number: '#ffa657',
  }),
];

export const THEME_STORAGE_KEY = 'syncode.theme';

export function findThemeByName(name: string): ThemeEntry {
  return (
    BUILT_IN_THEMES.find((theme) => theme.name === name) ?? BUILT_IN_THEMES[0]
  );
}

export function readSavedTheme(): ThemeEntry {
  try {
    const stored =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(THEME_STORAGE_KEY)
        : null;
    if (!stored) return BUILT_IN_THEMES[0];
    return findThemeByName(getStoredThemeName(stored));
  } catch {
    return BUILT_IN_THEMES[0];
  }
}

export function applyTheme(entry: ThemeEntry, monaco: Monaco | null): void {
  const theme = entry.value;
  applyCssTheme(theme);
  if (!monaco) return;
  monaco.editor.defineTheme('syncode-current-theme', {
    base: getThemeBase(theme.type),
    inherit: true,
    rules: getThemeRules(theme),
    colors: theme.colors as Record<string, string>,
  });
  monaco.editor.setTheme('syncode-current-theme');
}

export function applyCssTheme(theme: ThemeEntry['value']): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(getThemeCssVariables(theme)).forEach(([key, value]) =>
    root.style.setProperty(key, value)
  );
  root.style.colorScheme = theme.type?.toLowerCase().includes('light')
    ? 'light'
    : 'dark';
}

export function applySavedTheme(monaco: Monaco): void {
  const selected = readSavedTheme();
  applyTheme(selected, monaco);
}
