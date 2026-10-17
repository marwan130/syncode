import type { BuiltInModelCatalog } from './providerCatalog';

export async function getBuiltInModelCatalog(
  signal?: AbortSignal
): Promise<BuiltInModelCatalog> {
  const response = await fetch('/api/ai/models', { signal });
  if (!response.ok) {
    throw new Error('The built-in AI model list is unavailable.');
  }

  const catalog: unknown = await response.json();
  if (!isBuiltInModelCatalog(catalog)) {
    throw new Error('The built-in AI model list returned an invalid response.');
  }

  return catalog;
}

function isBuiltInModelCatalog(value: unknown): value is BuiltInModelCatalog {
  if (!value || typeof value !== 'object') return false;

  const catalog = value as Partial<BuiltInModelCatalog>;
  return (
    typeof catalog.available === 'boolean' &&
    Array.isArray(catalog.models) &&
    catalog.models.every(
      (model) =>
        model &&
        typeof model.id === 'string' &&
        typeof model.name === 'string' &&
        model.providerId === 'syncode' &&
        model.mode === 'builtin'
    )
  );
}
