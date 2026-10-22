import { describe, expect, it } from 'vitest';
import { getIgnoredDirectoryPath, getImportIgnoreReason } from '../ignoreRules';

describe('folder import ignore rules', () => {
  it.each([
    ['node_modules', true, 'Generated or dependency folder'],
    [
      'src/node_modules/pkg/index.js',
      false,
      'Inside an ignored generated or dependency folder',
    ],
    ['.ENV.production', false, 'Environment file may contain secrets'],
    ['certs/server.PEM', false, 'Private key or certificate'],
    ['assets/logo.PNG', false, 'Binary file'],
    ['Thumbs.db', false, 'Operating system file'],
  ])('filters %s', (path, isDirectory, reason) => {
    expect(getImportIgnoreReason(path, isDirectory)).toBe(reason);
  });

  it('allows regular source files and folders', () => {
    expect(getImportIgnoreReason('src/App.tsx', false)).toBeNull();
    expect(getImportIgnoreReason('src/components', true)).toBeNull();
  });

  it('returns the first ignored directory in a nested path', () => {
    expect(getIgnoredDirectoryPath('src/dist/generated/app.js')).toBe(
      'src/dist'
    );
    expect(getIgnoredDirectoryPath('src/features/app.ts')).toBeNull();
  });
});
