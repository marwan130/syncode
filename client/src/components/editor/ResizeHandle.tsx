import { useRef } from 'react';

interface ResizeHandleProps {
  label: string;
  onResize: (deltaX: number) => void;
  reverse?: boolean;
}

export function ResizeHandle({
  label,
  onResize,
  reverse = false,
}: ResizeHandleProps) {
  const previousX = useRef(0);

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        previousX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('is-dragging');
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = event.clientX - previousX.current;
        previousX.current = event.clientX;
        onResize(reverse ? -delta : delta);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        event.currentTarget.classList.remove('is-dragging');
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onResize(reverse ? 16 : -16);
        if (event.key === 'ArrowRight') onResize(reverse ? -16 : 16);
      }}
    />
  );
}

