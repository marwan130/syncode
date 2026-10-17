import type {
  AiModelOption,
  AiProviderId,
} from './providers/AiProvider';

export type AiSettings =
  | {
      mode: 'builtin';
      providerId: 'syncode';
      modelId: string;
    }
  | {
      mode: 'byok';
      providerId: AiProviderId;
      modelId: string;
      apiKey: string;
    };

let settings: AiSettings = {
  mode: 'builtin',
  providerId: 'syncode',
  modelId: '',
};

export function getAiSettings(): AiSettings {
  return { ...settings };
}

export function setAiSettings(next: AiSettings): void {
  settings = { ...next };
}

export function clearAiSettings(): void {
  settings = {
    mode: 'builtin',
    providerId: 'syncode',
    modelId: '',
  };
}

export function selectAiModel(
  model: AiModelOption,
  apiKey?: string
): void {
  if (model.mode === 'builtin') {
    settings = {
      mode: 'builtin',
      providerId: 'syncode',
      modelId: model.id,
    };
    return;
  }

  if (!apiKey?.trim()) {
    throw new Error('An API key is required for this provider.');
  }

  settings = {
    mode: 'byok',
    providerId: model.providerId,
    modelId: model.id,
    apiKey,
  };
}
