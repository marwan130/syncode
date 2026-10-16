import { useEffect, useLayoutEffect, useRef } from 'react';

export function useOutsidePointerDismiss(
  isOpen: boolean,
  onDismiss: () => void,
  isInside: (target: EventTarget | null) => boolean
) {
  const callbacks = useRef({ onDismiss, isInside });
  useLayoutEffect(() => {
    callbacks.current = { onDismiss, isInside };
  }, [onDismiss, isInside]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!callbacks.current.isInside(event.target))
        callbacks.current.onDismiss();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);
}
