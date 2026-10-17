export type AiActionId = 'explain-selection';

export interface AiActionDefinition {
  id: AiActionId;
  label: string;
  requiresSelection: boolean;
}

export const AI_ACTIONS: readonly AiActionDefinition[] = [
  {
    id: 'explain-selection',
    label: 'Explain selection',
    requiresSelection: true,
  },
];
