import { useEffect, useRef, useState } from 'react';
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

const BUILT_INS: ThemeEntry[] = [
  {
    name: 'Default Dark+',
    value: {
      name: 'Default Dark+',
      type: 'dark',
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'sideBar.background': '#181818',
        'panel.background': '#181818',
        'input.background': '#252526',
        focusBorder: '#007fd4',
        'activityBar.background': '#181818',
      },
      tokenColors: [
        { scope: ['comment'], settings: { foreground: '#6a9955' } },
        { scope: ['keyword'], settings: { foreground: '#569cd6' } },
        { scope: ['string'], settings: { foreground: '#ce9178' } },
        {
          scope: ['entity.name.function'],
          settings: { foreground: '#dcdcaa' },
        },
      ],
    },
  },
  {
    name: 'Default Light+',
    value: {
      name: 'Default Light+',
      type: 'light',
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#333333',
        'sideBar.background': '#f3f3f3',
        'panel.background': '#f3f3f3',
        'input.background': '#ffffff',
        focusBorder: '#0090f1',
        'activityBar.background': '#f3f3f3',
      },
      tokenColors: [
        { scope: ['comment'], settings: { foreground: '#008000' } },
        { scope: ['keyword'], settings: { foreground: '#0000ff' } },
        { scope: ['string'], settings: { foreground: '#a31515' } },
      ],
    },
  },
  {
    name: 'Monokai',
    value: {
      name: 'Monokai',
      type: 'dark',
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#f8f8f2',
        'sideBar.background': '#20211c',
        'panel.background': '#20211c',
        'input.background': '#34352f',
        focusBorder: '#a6e22e',
        'activityBar.background': '#20211c',
      },
      tokenColors: [
        { scope: ['comment'], settings: { foreground: '#75715e' } },
        { scope: ['keyword'], settings: { foreground: '#f92672' } },
        { scope: ['string'], settings: { foreground: '#e6db74' } },
        {
          scope: ['entity.name.function'],
          settings: { foreground: '#a6e22e' },
        },
      ],
    },
  },
  {
    name: 'Solarized Dark',
    value: {
      name: 'Solarized Dark',
      type: 'dark',
      colors: {
        'editor.background': '#002b36',
        'editor.foreground': '#839496',
        'sideBar.background': '#073642',
        'panel.background': '#073642',
        'input.background': '#073642',
        focusBorder: '#268bd2',
        'activityBar.background': '#073642',
      },
      tokenColors: [
        { scope: ['comment'], settings: { foreground: '#586e75' } },
        { scope: ['keyword'], settings: { foreground: '#859900' } },
        { scope: ['string'], settings: { foreground: '#2aa198' } },
      ],
    },
  },
];

const STORAGE_KEY = 'syncode.theme';
function readSaved(): ThemeEntry {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null'
    ) as ThemeEntry | null;
    if (
      parsed?.value?.name &&
      (parsed.value.colors ||
        parsed.value.tokenColors ||
        parsed.value.semanticTokenColors)
    )
      return parsed;
  } catch {
    /* Use the built-in default when saved theme data is invalid. */
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
  const vars: Record<string, string> = {
    '--app-bg': get('titleBar.activeBackground', get('sideBar.background', bg)),
    '--surface-bg': get('panel.background', get('sideBar.background', bg)),
    '--control-bg': get('input.background', bg),
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
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (monaco) apply(selected, monaco);
  }, [monaco, selected]);
  const choose = (entry: ThemeEntry) => {
    setSelected(entry);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    } catch {
      // Apply the selected theme for this session even when storage is unavailable.
    }
    apply(entry, monaco);
  };
  const importTheme = async (file?: File) => {
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as VscodeTheme;
      if (
        !value ||
        typeof value !== 'object' ||
        (!value.colors && !value.tokenColors && !value.semanticTokenColors)
      )
        throw new Error('The file is not a VS Code color theme JSON.');
      choose({ name: value.name || file.name.replace(/\.json$/i, ''), value });
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : 'Could not import theme.'
      );
    }
  };
  return (
    <div className="theme-picker">
      <select
        aria-label="Color theme"
        value={
          BUILT_INS.some((theme) => theme.name === selected.name)
            ? selected.name
            : 'custom'
        }
        onChange={(event) => {
          if (event.target.value === 'import') upload.current?.click();
          else if (event.target.value === 'custom') return;
          else {
            const entry = BUILT_INS.find(
              (theme) => theme.name === event.target.value
            );
            if (entry) choose(entry);
          }
        }}
      >
        {BUILT_INS.map((theme) => (
          <option key={theme.name} value={theme.name}>
            {theme.name}
          </option>
        ))}
        {!BUILT_INS.some((theme) => theme.name === selected.name) && (
          <option value="custom">{selected.name}</option>
        )}
        <option value="import">Import VS Code theme…</option>
      </select>
      <input
        ref={upload}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(event) => {
          void importTheme(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}

export function ThemeInitializer() {
  useEffect(() => apply(readSaved(), null), []);
  return null;
}
