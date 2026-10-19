import { useEffect, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';

interface VscodeTheme {
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
interface ThemeEntry {
  name: string;
  value: VscodeTheme;
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

const BUILT_INS: ThemeEntry[] = [
  builtInTheme('Default Dark+', 'dark', {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    sidebar: '#181818',
    control: '#252526',
    accent: '#007fd4',
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

const STORAGE_KEY = 'syncode.theme';
function readSaved(): ThemeEntry {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return BUILT_INS[0];
    let name = stored;
    try {
      const parsed = JSON.parse(stored) as {
        name?: string;
        value?: { name?: string };
      };
      if (typeof parsed === 'string') name = parsed;
      else name = parsed.name ?? parsed.value?.name ?? stored;
    } catch {
      // Older installations stored the theme name directly.
    }
    return BUILT_INS.find((theme) => theme.name === name) ?? BUILT_INS[0];
  } catch {
    // Fall back to the built-in default when browser storage is unavailable.
  }
  return BUILT_INS[0];
}
function apply(entry: ThemeEntry, monaco: Monaco | null) {
  const theme = entry.value;
  const colors = theme.colors ?? {};
  const root = document.documentElement;
  const get = (key: string, fallback: string) => colors[key] ?? fallback;
  const bg = get('editor.background', '#1e1e1e');
  const fg = get('editor.foreground', '#d4d4d4');
  const border = get(
    'sideBar.border',
    theme.type === 'light' ? '#d4d4d4' : '#3c3c3c'
  );
  const isLightTheme = theme.type?.toLowerCase().includes('light') ?? false;
  const vars: Record<string, string> = {
    '--app-bg': get('titleBar.activeBackground', get('sideBar.background', bg)),
    '--surface-bg': get('panel.background', get('sideBar.background', bg)),
    '--control-bg': get('input.background', bg),
    '--input-fg': get('input.foreground', fg),
    '--input-placeholder': get(
      'input.placeholderForeground',
      get('descriptionForeground', theme.type === 'light' ? '#666666' : '#9ca3af')
    ),
    '--bg': bg,
    '--code-bg': bg,
    '--text': fg,
    '--text-h': get('editor.foreground', fg),
    '--text-muted': get(
      'descriptionForeground',
      theme.type === 'light' ? '#666666' : '#9ca3af'
    ),
    '--border': border,
    '--accent': get('focusBorder', '#38bdf8'),
    '--button-bg': get('button.background', get('focusBorder', '#0284c7')),
    '--button-fg': get('button.foreground', '#ffffff'),
    '--accent-bg': `${get('focusBorder', '#38bdf8')}22`,
    '--accent-border': get('focusBorder', '#38bdf8'),
    '--danger': get('errorForeground', '#ef4444'),
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
  };
  Object.entries(vars).forEach(([key, value]) =>
    root.style.setProperty(key, value)
  );
  root.style.colorScheme = theme.type?.toLowerCase().includes('light')
    ? 'light'
    : 'dark';
  if (!monaco) return;
  const textMateRules = (theme.tokenColors ?? []).flatMap((token) => {
    const scopes = Array.isArray(token.scope)
      ? token.scope
      : (token.scope ?? '')
          .split(',')
          .map((scope) => scope.trim())
          .filter(Boolean);
    if (!token.settings) return [];
    return scopes.map((scope) => ({
      token: scope,
      foreground: token.settings!.foreground?.replace('#', ''),
      fontStyle: token.settings!.fontStyle,
    }));
  });
  const semanticRules = Object.entries(theme.semanticTokenColors ?? {}).flatMap(
    ([token, style]) => {
      const settings =
        typeof style === 'string' ? { foreground: style } : style;
      if (!settings.foreground) return [];
      return [
        {
          token: token.replace(/:[\w.-]+/g, ''),
          foreground: settings.foreground.replace('#', ''),
          fontStyle: [
            settings.bold && 'bold',
            settings.italic && 'italic',
            settings.underline && 'underline',
          ]
            .filter(Boolean)
            .join(' '),
        },
      ];
    }
  );
  const monacoName = 'syncode-current-theme';
  const type = theme.type?.toLowerCase();
  const base =
    type === 'hc'
      ? 'hc-black'
      : type === 'hclight'
        ? 'hc-light'
        : type === 'light'
          ? 'vs'
          : 'vs-dark';
  monaco.editor.defineTheme(monacoName, {
    base,
    inherit: true,
    rules: [...textMateRules, ...semanticRules],
    colors: colors as Record<string, string>,
  });
  monaco.editor.setTheme(monacoName);
}

export function ThemePicker({ monaco }: { monaco: Monaco | null }) {
  const [selected, setSelected] = useState(readSaved);
  useEffect(() => {
    if (monaco) apply(selected, monaco);
  }, [monaco, selected]);
  const choose = (entry: ThemeEntry) => {
    setSelected(entry);
    try {
      localStorage.setItem(STORAGE_KEY, entry.name);
    } catch {
      // Keep the selected theme active for this session if storage is unavailable.
    }
  };
  return (
    <div className="theme-picker">
      <select
        aria-label="Color theme"
        value={selected.name}
        onChange={(event) => {
          const entry = BUILT_INS.find(
            (theme) => theme.name === event.target.value
          );
          if (entry) choose(entry);
        }}
      >
        {BUILT_INS.map((theme) => (
          <option key={theme.name} value={theme.name}>
            {theme.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ThemeInitializer() {
  useEffect(() => apply(readSaved(), null), []);
  return null;
}
