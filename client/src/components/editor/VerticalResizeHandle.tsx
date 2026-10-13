import { useRef } from 'react';

interface VerticalResizeHandleProps {
  label: string;
  onResize: (deltaY: number) => void;
}

export function VerticalResizeHandle({
  label,
  onResize,
}: VerticalResizeHandleProps) {
  const previousY = useRef(0);
  return (
    <div
      className="vertical-resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        previousY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('is-dragging');
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = previousY.current - event.clientY;
        previousY.current = event.clientY;
        onResize(delta);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        event.currentTarget.classList.remove('is-dragging');
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') onResize(16);
        if (event.key === 'ArrowDown') onResize(-16);
      }}
    />
  );
}
