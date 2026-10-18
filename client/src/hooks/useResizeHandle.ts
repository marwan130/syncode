import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

type ResizeAxis = 'horizontal' | 'vertical';

function getResizeDelta(
  axis: ResizeAxis,
  previousPosition: number,
  position: number,
  reverse: boolean
): number {
  const delta =
    axis === 'horizontal'
      ? position - previousPosition
      : previousPosition - position;
  return reverse ? -delta : delta;
}

function getResizeKeyboardDelta(
  axis: ResizeAxis,
  key: string,
  reverse: boolean
): number | null {
  const direction =
    axis === 'horizontal'
      ? key === 'ArrowLeft'
        ? -1
        : key === 'ArrowRight'
          ? 1
          : 0
      : key === 'ArrowUp'
        ? 1
        : key === 'ArrowDown'
          ? -1
          : 0;
  if (!direction) return null;
  return direction * (reverse ? -1 : 1) * 16;
}

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
    const delta = getResizeDelta(
      axis,
      previousPosition.current,
      position,
      reverse
    );
    previousPosition.current = position;
    onResize(delta);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.classList.remove('is-dragging');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = getResizeKeyboardDelta(axis, event.key, reverse);
    if (delta === null) return;
    event.preventDefault();
    onResize(delta);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
