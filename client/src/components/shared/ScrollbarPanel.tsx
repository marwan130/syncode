import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  HTMLAttributes,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
} from 'react';

type PanelElement = 'aside' | 'div';

interface ScrollbarPanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelElement;
  children: ReactNode;
}

interface ScrollMetrics {
  hasOverflow: boolean;
  thumbHeight: number;
  thumbTop: number;
  value: number;
}

const INITIAL_METRICS: ScrollMetrics = {
  hasOverflow: false,
  thumbHeight: 0,
  thumbTop: 0,
  value: 0,
};

export function ScrollbarPanel({
  as: Element = 'div',
  children,
  className = '',
  ...props
}: ScrollbarPanelProps) {
  const id = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
  const pointerInsideRef = useRef(false);
  const [isScrollbarVisible, setScrollbarVisible] = useState(false);
  const [metrics, setMetrics] = useState(INITIAL_METRICS);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scrollRange = viewport.scrollHeight - viewport.clientHeight;
    const hasOverflow = scrollRange > 1;
    const thumbHeight = hasOverflow
      ? Math.min(
          viewport.clientHeight,
          Math.max(
            20,
            (viewport.clientHeight / viewport.scrollHeight) *
              viewport.clientHeight
          )
        )
      : 0;
    const thumbRange = Math.max(0, viewport.clientHeight - thumbHeight);
    const next = {
      hasOverflow,
      thumbHeight,
      thumbTop:
        scrollRange > 0 ? (viewport.scrollTop / scrollRange) * thumbRange : 0,
      value:
        scrollRange > 0
          ? Math.round((viewport.scrollTop / scrollRange) * 100)
          : 0,
    };

    if (!hasOverflow) setScrollbarVisible(false);

    setMetrics((current) =>
      current.hasOverflow === next.hasOverflow &&
      current.thumbHeight === next.thumbHeight &&
      current.thumbTop === next.thumbTop &&
      current.value === next.value
        ? current
        : next
    );
  }, []);

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

    if (isOnSlider) {
      slider?.classList.add('active');
      dragRef.current = {
        pointerY: event.clientY,
        scrollTop: viewport.scrollTop,
      };
      return;
    }

    const bounds = track.getBoundingClientRect();
    const maxScroll = viewport.scrollHeight - viewport.clientHeight;
    const thumbRange = Math.max(1, bounds.height - metrics.thumbHeight);
    const desiredTop = Math.max(
      0,
      Math.min(thumbRange, event.clientY - bounds.top - metrics.thumbHeight / 2)
    );
    viewport.scrollTop = (desiredTop / thumbRange) * maxScroll;
    dragRef.current = {
      pointerY: event.clientY,
      scrollTop: viewport.scrollTop,
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

    const thumbRange = Math.max(1, viewport.clientHeight - metrics.thumbHeight);
    const scrollRange = Math.max(
      0,
      viewport.scrollHeight - viewport.clientHeight
    );
    viewport.scrollTop =
      drag.scrollTop +
      ((event.clientY - drag.pointerY) / thumbRange) * scrollRange;
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
    const page = viewport.clientHeight;
    const targets: Record<string, number> = {
      ArrowDown: viewport.scrollTop + 40,
      ArrowUp: viewport.scrollTop - 40,
      PageDown: viewport.scrollTop + page,
      PageUp: viewport.scrollTop - page,
      Home: 0,
      End: viewport.scrollHeight,
    };
    if (!Object.hasOwn(targets, event.key)) return;
    event.preventDefault();
    revealScrollbar();
    viewport.scrollTop = targets[event.key];
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
          onScroll={handleScroll}
        >
          <div className="syncode-scrollbar-content">{children}</div>
        </div>
        <div
          className={`scrollbar vertical ${scrollbarClass}`}
          role="scrollbar"
          aria-label="Scroll content"
          aria-controls={id}
          aria-orientation="vertical"
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
            style={{ height: metrics.thumbHeight, top: metrics.thumbTop }}
          />
        </div>
      </div>
    </Element>
  );
}
