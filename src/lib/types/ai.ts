export type AIProviderType = "anthropic" | "openai-compatible";

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  baseUrl?: string; // openai-compatible only
}

export interface AISettings {
  providers: AIProvider[];
  shareSchemaGlobally: boolean;
  shareDataGlobally: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  providers: [],
  shareSchemaGlobally: true,
  shareDataGlobally: false,
};
