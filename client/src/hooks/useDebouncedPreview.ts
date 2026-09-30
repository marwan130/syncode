import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { SignalRCrdtProvider } from '../providers/SignalRCrdtProvider';
import type { ConnectionStatus } from '../providers/SignalRCrdtProvider';

interface UseDebouncedPreviewProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
  enabled: boolean;
}

export function useDebouncedPreview({
  providerRef,
  status,
  enabled,
}: UseDebouncedPreviewProps): string {
  const [source, setSource] = useState('');

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !enabled) {
      setSource('');
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const updateSource = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setSource(provider.doc.toVisibleString());
        timer = null;
      }, 300);
    };

    setSource(provider.doc.toVisibleString());
    const unsubscribe = provider.onDocumentChange(updateSource);

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [providerRef, status, enabled]);

  return source;
}
