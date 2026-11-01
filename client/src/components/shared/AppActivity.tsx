import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppActivityContext } from './appActivityContext';

export function AppActivityProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [activities, setActivities] = useState<Map<number, string>>(
    () => new Map()
  );
  const beginActivity = useCallback((label: string) => {
    const id = ++nextId.current;
    setActivities((current) => new Map(current).set(id, label));
    return () =>
      setActivities((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
  }, []);
  const runActivity = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
      const finish = beginActivity(label);
      try {
        return await action();
      } finally {
        finish();
      }
    },
    [beginActivity]
  );
  const activeActivities = Array.from(activities.values());
  const currentActivity =
    activeActivities
      .slice()
      .reverse()
      .find((activity) => activity !== 'Saving changes…') ??
    activeActivities[0];

  return (
    <AppActivityContext.Provider
      value={{ beginActivity, runActivity, currentActivity }}
    >
      {children}
    </AppActivityContext.Provider>
  );
}
