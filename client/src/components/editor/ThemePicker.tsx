import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Monaco } from '@monaco-editor/react';
import {
  getThemeBase,
  getThemeCssVariables,
  getThemeRules,
  getStoredThemeName,
  type ThemeEntry,
} from './themeUtils';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';

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
    return findThemeByName(getStoredThemeName(stored));
  } catch {
    return BUILT_INS[0];
  }
}

function findThemeByName(name: string) {
  return BUILT_INS.find((theme) => theme.name === name) ?? BUILT_INS[0];
}

function applyTheme(entry: ThemeEntry, monaco: Monaco | null) {
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

function applyCssTheme(theme: ThemeEntry['value']) {
  const root = document.documentElement;
  Object.entries(getThemeCssVariables(theme)).forEach(([key, value]) =>
    root.style.setProperty(key, value)
  );
  root.style.colorScheme = theme.type?.toLowerCase().includes('light')
    ? 'light'
    : 'dark';
}

export function ThemePicker({ monaco }: { monaco: Monaco | null }) {
  const [selected, setSelected] = useState(readSaved);
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(selected, monaco);
  }, [monaco, selected]);

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        applyTheme(selected, monaco);
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [isOpen, monaco, selected]);

  const choose = (entry: ThemeEntry) => {
    setSelected(entry);
    applyTheme(entry, monaco);
    setIsOpen(false);
    triggerRef.current?.focus();
    try {
      localStorage.setItem(STORAGE_KEY, entry.name);
    } catch {
      return;
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      applyTheme(selected, monaco);
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const options = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]'
      ) ?? []
    );
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    options[(current + offset + options.length) % options.length]?.focus();
  };

  const toggleMenu = () => {
    if (isOpen) applyTheme(selected, monaco);
    setIsOpen((open) => !open);
  };

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        className="theme-picker-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Color theme: ${selected.name}`}
        onClick={toggleMenu}
      >
        <span>{selected.name}</span>
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          className="theme-picker-menu"
          role="menu"
          aria-label="Color themes"
          onKeyDown={handleMenuKeyDown}
        >
          <ScrollbarPanel className="theme-picker-scroll">
            {BUILT_INS.map((theme) => (
              <ThemeMenuItem
                key={theme.name}
                theme={theme}
                selected={theme.name === selected.name}
                onPreview={() => applyTheme(theme, monaco)}
                onChoose={() => choose(theme)}
              />
            ))}
          </ScrollbarPanel>
        </div>
      )}
    </div>
  );
}

function ThemeMenuItem({
  theme,
  selected,
  onPreview,
  onChoose,
}: {
  theme: ThemeEntry;
  selected: boolean;
  onPreview: () => void;
  onChoose: () => void;
}) {
  const colors = theme.value.colors ?? {};
  const previewStyle = {
    '--theme-preview-background': colors['editor.background'] ?? '#1e1e1e',
    '--theme-preview-comment': getTokenColor(theme, 'comment', '#6a9955'),
    '--theme-preview-keyword': getTokenColor(theme, 'keyword', '#569cd6'),
    '--theme-preview-string': getTokenColor(theme, 'string', '#ce9178'),
  } as CSSProperties;

  return (
    <button
      className={`theme-picker-item${selected ? ' is-selected' : ''}`}
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onFocus={onPreview}
      onMouseEnter={onPreview}
      onClick={onChoose}
    >
      <span
        className="theme-picker-preview"
        style={previewStyle}
        aria-hidden="true"
      >
        <span className="theme-preview-code">
          {Array.from({ length: 9 }, (_, index) => (
            <i key={index} />
          ))}
        </span>
      </span>
      <span className="theme-picker-label">{theme.name}</span>
    </button>
  );
}

function getTokenColor(theme: ThemeEntry, scope: string, fallback: string) {
  const token = theme.value.tokenColors?.find((entry) => {
    const scopes = Array.isArray(entry.scope)
      ? entry.scope
      : (entry.scope ?? '').split(',').map((value) => value.trim());
    return scopes.some((value) => value.includes(scope));
  });
  return token?.settings?.foreground ?? fallback;
}

export function ThemeInitializer() {
  useEffect(() => applyTheme(readSaved(), null), []);
  return null;
}
