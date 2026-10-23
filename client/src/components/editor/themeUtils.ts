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
