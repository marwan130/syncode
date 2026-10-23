import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppFeedbackContext } from './appFeedbackContext';

interface FeedbackRequest {
  id: number;
  message: string;
  kind: 'message' | 'confirm';
  resolve: (confirmed: boolean) => void;
}

export function AppFeedbackProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<FeedbackRequest[]>([]);
  const nextId = useRef(0);
  const settledIds = useRef(new Set<number>());
  const activeRequest = requests[0];

  const enqueue = useCallback(
    (kind: FeedbackRequest['kind'], message: string) =>
      new Promise<boolean>((resolve) => {
        const id = ++nextId.current;
        setRequests((current) => [...current, { id, kind, message, resolve }]);
      }),
    []
  );

  const showMessage = useCallback(
    async (message: string) => {
      await enqueue('message', message);
    },
    [enqueue]
  );

  const confirm = useCallback(
    (message: string) => enqueue('confirm', message),
    [enqueue]
  );

  const finish = useCallback(
    (confirmed: boolean) => {
      const finished = activeRequest;
      if (!finished || settledIds.current.has(finished.id)) return;
      settledIds.current.add(finished.id);
      finished.resolve(confirmed);
      setRequests((current) => {
        return current[0]?.id === finished.id ? current.slice(1) : current;
      });
    },
    [activeRequest]
  );

  useEffect(() => {
    if (!activeRequest) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRequest, finish]);

  return (
    <AppFeedbackContext.Provider value={{ showMessage, confirm }}>
      {children}
      {activeRequest && (
        <div
          className="app-feedback-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finish(false);
          }}
        >
          <section
            className="app-feedback-dialog"
            role={activeRequest.kind === 'message' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-describedby="app-feedback-message"
          >
            <p id="app-feedback-message">{activeRequest.message}</p>
            <div className="app-feedback-actions">
              {activeRequest.kind === 'confirm' && (
                <button type="button" onClick={() => finish(false)}>
                  Cancel
                </button>
              )}
              <button type="button" autoFocus onClick={() => finish(true)}>
                {activeRequest.kind === 'confirm' ? 'Continue' : 'OK'}
              </button>
            </div>
          </section>
        </div>
      )}
    </AppFeedbackContext.Provider>
  );
}
