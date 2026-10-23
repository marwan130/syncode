import { useContext } from 'react';
import { AppFeedbackContext } from './appFeedbackContext';

export function useAppFeedback() {
  const value = useContext(AppFeedbackContext);
  if (!value) throw new Error('App feedback is unavailable.');
  return value;
}
