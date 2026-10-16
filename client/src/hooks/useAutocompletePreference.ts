import { useCallback, useEffect, useState } from 'react';
import {
  getAutocompleteEnabled,
  setAutocompleteEnabled,
} from '../utils/autocompletePreference';

export function useAutocompletePreference(): [
  boolean,
  (enabled: boolean) => void,
] {
  const [enabled, setEnabled] = useState(getAutocompleteEnabled);

  useEffect(() => {
    const syncPreference = () => setEnabled(getAutocompleteEnabled());
    window.addEventListener('storage', syncPreference);
    return () => window.removeEventListener('storage', syncPreference);
  }, []);

  const updatePreference = useCallback((nextEnabled: boolean) => {
    setAutocompleteEnabled(nextEnabled);
    setEnabled(nextEnabled);
  }, []);

  return [enabled, updatePreference];
}
