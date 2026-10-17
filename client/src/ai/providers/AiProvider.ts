export type AiProviderMode = 'builtin' | 'byok';

export type AiProviderId = 'openai-compatible' | 'anthropic';

export type AiModelOption =
  | {
      id: string;
      name: string;
      providerId: 'syncode';
      mode: 'builtin';
    }
  | {
      id: string;
      name: string;
      providerId: AiProviderId;
      mode: 'byok';
    };

export interface AiRequestContext {
  language: string;
  selection?: string;
  source?: string;
  userPrompt: string;
}

export interface AiProviderRequest {
  providerId: AiProviderId;
  model: string;
  context: AiRequestContext;
  apiKey: string;
}

export interface AiProvider {
  stream(
    request: AiProviderRequest,
    signal: AbortSignal,
    onText: (text: string) => void
  ): Promise<void>;
}
