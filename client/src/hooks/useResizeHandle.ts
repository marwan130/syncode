import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

type ResizeAxis = 'horizontal' | 'vertical';

export function useResizeHandle(
  axis: ResizeAxis,
  onResize: (delta: number) => void,
  reverse = false
) {
  const previousPosition = useRef(0);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    previousPosition.current =
      axis === 'horizontal' ? event.clientX : event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add('is-dragging');
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const position = axis === 'horizontal' ? event.clientX : event.clientY;
    const delta =
      axis === 'horizontal'
        ? position - previousPosition.current
        : previousPosition.current - position;
    previousPosition.current = position;
    onResize(reverse ? -delta : delta);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove('is-dragging');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction =
      axis === 'horizontal'
        ? event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowRight'
            ? 1
            : 0
        : event.key === 'ArrowUp'
          ? 1
          : event.key === 'ArrowDown'
            ? -1
            : 0;
    if (!direction) return;
    event.preventDefault();
    onResize(direction * (reverse ? -1 : 1) * 16);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
