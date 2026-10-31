import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@iconify/react';

export function SourceControlPanel({
  title,
  count,
  defaultOpen = false,
  className = '',
  style,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      className={`source-control-panel${isOpen ? ' is-open' : ''} ${className}`}
      style={style}
    >
      <button
        type="button"
        className="source-control-panel-heading"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon
          className="source-control-panel-chevron"
          icon="codicon:chevron-right"
          aria-hidden="true"
        />
        <strong>{title}</strong>
        {count !== undefined && <span>{count}</span>}
      </button>
      {isOpen && <div className="source-control-panel-body">{children}</div>}
    </section>
  );
}
