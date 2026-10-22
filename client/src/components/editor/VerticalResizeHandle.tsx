import { useResizeHandle } from '../../hooks/useResizeHandle';

export interface VerticalResizeHandleProps {
  label: string;
  onResize: (deltaY: number) => void;
}

export function VerticalResizeHandle({
  label,
  onResize,
}: VerticalResizeHandleProps) {
  const resizeHandlers = useResizeHandle('vertical', onResize);
  return (
    <div
      className="vertical-resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      {...resizeHandlers}
    />
  );
}
