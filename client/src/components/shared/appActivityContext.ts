import { createContext } from 'react';

export interface AppActivityValue {
  beginActivity: (label: string) => () => void;
  runActivity: <T>(label: string, action: () => Promise<T>) => Promise<T>;
  currentActivity?: string;
}

export const AppActivityContext = createContext<AppActivityValue>({
  beginActivity: () => () => {},
  runActivity: (_label, action) => action(),
});
