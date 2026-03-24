export type AIProviderType = "anthropic" | "openai-compatible";

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  baseUrl?: string; // openai-compatible only
}

export interface AISettings {
  enabled: boolean;
  providers: AIProvider[];
  shareSchemaGlobally: boolean;
  shareDataGlobally: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  providers: [],
  shareSchemaGlobally: true,
  shareDataGlobally: false,
};
