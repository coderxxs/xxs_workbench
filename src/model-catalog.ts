import { ProviderConfig } from "./types";

export interface ProviderModelOption {
  id: string;
  name: string;
}

export const PROVIDER_MODEL_CATALOG: Record<string, ProviderModelOption[]> = {
  openai: [
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
  ],
  deepseek: [
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
  kimi: [
    { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro" },
    { id: "kimi-k3.1-pro-highspeed", name: "Kimi K3.1 Pro Highspeed" },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
};

const LEGACY_DEFAULT_MODELS: Record<string, Record<string, string>> = {
  openai: { "gpt-5.6": "gpt-5.6-sol" },
  deepseek: { "deepseek-chat": "deepseek-flash" },
  kimi: { "kimi-k2.5": "kimi-k3.1-pro" },
};

export function providerModelOptions(provider: ProviderConfig): ProviderModelOption[] {
  const options = PROVIDER_MODEL_CATALOG[provider.id] ?? [];
  if (options.some((option) => option.id === provider.defaultModel)) return options;
  return [{ id: provider.defaultModel, name: provider.defaultModel }, ...options];
}

export function isProviderModelOption(providerId: string, modelId: string): boolean {
  return (PROVIDER_MODEL_CATALOG[providerId] ?? []).some((option) => option.id === modelId);
}

export function migrateLegacyProviderModels(providers: Record<string, ProviderConfig>): boolean {
  let changed = false;
  for (const provider of Object.values(providers)) {
    const replacement = LEGACY_DEFAULT_MODELS[provider.id]?.[provider.defaultModel];
    if (!replacement) continue;
    provider.defaultModel = replacement;
    changed = true;
  }
  return changed;
}
