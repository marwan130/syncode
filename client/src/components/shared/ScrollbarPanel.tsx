import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  HTMLAttributes,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  UIEventHandler,
} from 'react';

export type PanelElement = 'aside' | 'div';
export type ScrollbarOrientation = 'horizontal' | 'vertical';

export interface ScrollbarPanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelElement;
  children: ReactNode;
  orientation?: ScrollbarOrientation;
  onViewportScroll?: UIEventHandler<HTMLDivElement>;
}

interface ScrollMetrics {
  hasOverflow: boolean;
  thumbSize: number;
  thumbPosition: number;
  value: number;
}

const INITIAL_METRICS: ScrollMetrics = {
  hasOverflow: false,
  thumbSize: 0,
  thumbPosition: 0,
  value: 0,
};

export function ScrollbarPanel({
  as: Element = 'div',
  children,
  className = '',
  orientation = 'vertical',
  onViewportScroll,
  ...props
}: ScrollbarPanelProps) {
  const id = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerPosition: number;
    scrollPosition: number;
  } | null>(null);
  const pointerInsideRef = useRef(false);
  const [isScrollbarVisible, setScrollbarVisible] = useState(false);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scrollSize =
      orientation === 'horizontal'
        ? viewport.scrollWidth
        : viewport.scrollHeight;
    const clientSize =
      orientation === 'horizontal'
        ? viewport.clientWidth
        : viewport.clientHeight;
    const scrollPosition =
      orientation === 'horizontal' ? viewport.scrollLeft : viewport.scrollTop;
    const scrollRange = scrollSize - clientSize;
    const hasOverflow = scrollRange > 1;
    const thumbSize = hasOverflow
      ? Math.min(
          clientSize,
          Math.max(20, (clientSize / scrollSize) * clientSize)
        )
      : 0;
    const thumbRange = Math.max(0, clientSize - thumbSize);
    const next = {
      hasOverflow,
      thumbSize,
      thumbPosition:
        scrollRange > 0 ? (scrollPosition / scrollRange) * thumbRange : 0,
      value:
        scrollRange > 0 ? Math.round((scrollPosition / scrollRange) * 100) : 0,
    };

    if (!hasOverflow) setScrollbarVisible(false);

    setMetrics((current) =>
      current.hasOverflow === next.hasOverflow &&
      current.thumbSize === next.thumbSize &&
      current.thumbPosition === next.thumbPosition &&
      current.value === next.value
        ? current
        : next
    );
  }, [orientation]);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const revealScrollbar = () => {
    clearHideTimer();
    setScrollbarVisible(true);
  };

  const scheduleScrollbarHide = () => {
    clearHideTimer();
    if (pointerInsideRef.current || dragRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      setScrollbarVisible(false);
      hideTimerRef.current = null;
    }, 500);
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    return () => {
      observer.disconnect();
      clearHideTimer();
    };
  }, [measure]);

  const handleScroll = () => {
    measure();
    revealScrollbar();
    scheduleScrollbarHide();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const track = event.currentTarget;
    if (!viewport || event.button !== 0) return;

    event.preventDefault();
    revealScrollbar();
    track.setPointerCapture(event.pointerId);
    const slider = sliderRef.current;
    const isOnSlider = Boolean(slider?.contains(event.target as Node));
    const isHorizontal = orientation === 'horizontal';
    const pointerPosition = isHorizontal ? event.clientX : event.clientY;
    const scrollPosition = isHorizontal
      ? viewport.scrollLeft
      : viewport.scrollTop;

    if (isOnSlider) {
      slider?.classList.add('active');
      dragRef.current = { pointerPosition, scrollPosition };
      return;
    }

    const bounds = track.getBoundingClientRect();
    const maxScroll = isHorizontal
      ? viewport.scrollWidth - viewport.clientWidth
      : viewport.scrollHeight - viewport.clientHeight;
    const trackStart = isHorizontal ? bounds.left : bounds.top;
    const trackSize = isHorizontal ? bounds.width : bounds.height;
    const thumbRange = Math.max(1, trackSize - metrics.thumbSize);
    const desiredPosition = Math.max(
      0,
      Math.min(thumbRange, pointerPosition - trackStart - metrics.thumbSize / 2)
    );
    if (isHorizontal)
      viewport.scrollLeft = (desiredPosition / thumbRange) * maxScroll;
    else viewport.scrollTop = (desiredPosition / thumbRange) * maxScroll;
    dragRef.current = {
      pointerPosition,
      scrollPosition: isHorizontal ? viewport.scrollLeft : viewport.scrollTop,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (
      !viewport ||
      !drag ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;

    const isHorizontal = orientation === 'horizontal';
    const clientSize = isHorizontal
      ? viewport.clientWidth
      : viewport.clientHeight;
    const scrollSize = isHorizontal
      ? viewport.scrollWidth
      : viewport.scrollHeight;
    const scrollRange = Math.max(0, scrollSize - clientSize);
    const thumbRange = Math.max(1, clientSize - metrics.thumbSize);
    const pointerPosition = isHorizontal ? event.clientX : event.clientY;
    const nextPosition =
      drag.scrollPosition +
      ((pointerPosition - drag.pointerPosition) / thumbRange) * scrollRange;
    if (isHorizontal) viewport.scrollLeft = nextPosition;
    else viewport.scrollTop = nextPosition;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    sliderRef.current?.classList.remove('active');
    dragRef.current = null;
    scheduleScrollbarHide();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const isHorizontal = orientation === 'horizontal';
    const page = isHorizontal ? viewport.clientWidth : viewport.clientHeight;
    const position = isHorizontal ? viewport.scrollLeft : viewport.scrollTop;
    const max = isHorizontal ? viewport.scrollWidth : viewport.scrollHeight;
    const targets: Record<string, number> = {
      [isHorizontal ? 'ArrowRight' : 'ArrowDown']: position + 40,
      [isHorizontal ? 'ArrowLeft' : 'ArrowUp']: position - 40,
      PageDown: position + page,
      PageUp: position - page,
      Home: 0,
      End: max,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    revealScrollbar();
    if (isHorizontal) viewport.scrollLeft = targets[event.key];
    else viewport.scrollTop = targets[event.key];
  };

  const handleMouseEnter = () => {
    pointerInsideRef.current = true;
    if (metrics.hasOverflow) revealScrollbar();
  };

  const handleMouseLeave = () => {
    pointerInsideRef.current = false;
    scheduleScrollbarHide();
  };

  const handleScrollbarFocus = () => revealScrollbar();

  const handleScrollbarBlur = () => scheduleScrollbarHide();

  const scrollbarClass =
    metrics.hasOverflow && isScrollbarVisible ? 'visible' : 'invisible fade';

  return (
    <Element
      {...props}
      className={`syncode-scrollbar-panel xterm ${className}`.trim()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="xterm-scrollable-element syncode-scrollable-element">
        <div
          id={id}
          ref={viewportRef}
          className="syncode-scrollbar-viewport"
          onScroll={(event) => {
            handleScroll();
            onViewportScroll?.(event);
          }}
        >
          <div className="syncode-scrollbar-content">{children}</div>
        </div>
        <div
          className={`scrollbar ${orientation} syncode-scrollbar-track ${scrollbarClass}`}
          role="scrollbar"
          aria-label={
            orientation === 'horizontal' ? 'Scroll tabs' : 'Scroll content'
          }
          aria-controls={id}
          aria-orientation={orientation}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metrics.value}
          aria-hidden={!metrics.hasOverflow}
          tabIndex={metrics.hasOverflow ? 0 : -1}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={handleKeyDown}
          onFocus={handleScrollbarFocus}
          onBlur={handleScrollbarBlur}
          onLostPointerCapture={() => {
            sliderRef.current?.classList.remove('active');
            dragRef.current = null;
            scheduleScrollbarHide();
          }}
        >
          <div
            ref={sliderRef}
            className="slider"
            style={
              orientation === 'horizontal'
                ? { width: metrics.thumbSize, left: metrics.thumbPosition }
                : { height: metrics.thumbSize, top: metrics.thumbPosition }
            }
          />
        </div>
      </div>
    </Element>
  );
}
