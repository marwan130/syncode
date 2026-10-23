import { createContext } from 'react';

export interface AppFeedbackValue {
  showMessage: (message: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
}

export const AppFeedbackContext = createContext<AppFeedbackValue | null>(null);
