const STORAGE_KEY = 'syncode.editor.auto-completion';
let inMemoryPreference: boolean | null = null;
let useInMemoryPreference = false;

export function getAutocompleteEnabled(): boolean {
  if (useInMemoryPreference) return inMemoryPreference ?? true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    useInMemoryPreference = true;
    return inMemoryPreference ?? true;
  }
}

export function setAutocompleteEnabled(enabled: boolean): void {
  inMemoryPreference = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    useInMemoryPreference = false;
  } catch {
    useInMemoryPreference = true;
    // The in-memory value keeps this tab's preference available.
  }
}
