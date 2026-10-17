import type { AiModelOption, AiProviderId } from './providers/AiProvider';

export interface BuiltInModelCatalog {
  models: AiModelOption[];
  available: boolean;
}

export const BYOK_PROVIDER_IDS: readonly AiProviderId[] = [
  'openai-compatible',
  'anthropic',
];
