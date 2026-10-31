import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { Monaco } from '@monaco-editor/react';
import {
  applyTheme,
  BUILT_IN_THEMES,
  readSavedTheme,
  THEME_STORAGE_KEY,
  type ThemeEntry,
} from './themeUtils';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { moveMenuRadioFocus } from './menuKeyboardNavigation';
import { useOutsidePointerDismiss } from '../../hooks/useOutsidePointerDismiss';

export function ThemePicker({ monaco }: { monaco: Monaco | null }) {
  const [selected, setSelected] = useState(readSavedTheme);
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

  useOutsidePointerDismiss(
    isOpen,
    () => {
      applyTheme(selected, monaco);
      setIsOpen(false);
    },
    (target) => Boolean(target && pickerRef.current?.contains(target as Node))
  );

  const choose = (entry: ThemeEntry) => {
    setSelected(entry);
    applyTheme(entry, monaco);
    setIsOpen(false);
    triggerRef.current?.focus();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, entry.name);
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
    moveMenuRadioFocus(event, menuRef.current);
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
            {BUILT_IN_THEMES.map((theme) => (
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
  useEffect(() => applyTheme(readSavedTheme(), null), []);
  return null;
}
