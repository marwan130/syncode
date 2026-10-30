import { useContext } from 'react';
import { AppActivityContext } from './appActivityContext';

export function useAppActivity() {
  return useContext(AppActivityContext);
}
