import { useResizeHandle } from '../../hooks/useResizeHandle';

export interface ResizeHandleProps {
  label: string;
  onResize: (deltaX: number) => void;
  reverse?: boolean;
}

export function ResizeHandle({
  label,
  onResize,
  reverse = false,
}: ResizeHandleProps) {
  const resizeHandlers = useResizeHandle('horizontal', onResize, reverse);

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      {...resizeHandlers}
    />
  );
}
