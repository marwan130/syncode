import { useResizeHandle } from '../../hooks/useResizeHandle';

export interface VerticalResizeHandleProps {
  label: string;
  onResize: (deltaY: number) => void;
  className?: string;
}

export function VerticalResizeHandle({
  label,
  onResize,
  className = '',
}: VerticalResizeHandleProps) {
  const resizeHandlers = useResizeHandle('vertical', onResize);
  return (
    <div
      className={`vertical-resize-handle ${className}`.trim()}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      {...resizeHandlers}
    />
  );
}
