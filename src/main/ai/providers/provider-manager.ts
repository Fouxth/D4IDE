import { IAIProvider } from './provider-interface';
import { OpenAICompatibleProvider } from './openai-adapter';
import { GeminiProvider } from './gemini-adapter';
import { AnthropicProvider } from './anthropic-adapter';
import { appStore } from '../../database/store';
import { ProviderConfig } from '../../../shared/types';

export class ProviderManager {
  private instances = new Map<string, IAIProvider>();

  constructor() {
    this.reloadProviders();
  }

  reloadProviders(): void {
    this.instances.clear();
    const configs = appStore.getProviders();

    for (const conf of configs) {
      if (!conf.enabled) continue;

      if (conf.type === 'gemini') {
        this.instances.set(conf.id, new GeminiProvider(conf.apiKey || ''));
      } else if (conf.type === 'anthropic') {
        this.instances.set(conf.id, new AnthropicProvider(conf.apiKey || ''));
      } else {
        // OpenAI, DeepSeek, OpenRouter, xAI, Ollama, Custom
        const baseUrl = conf.baseUrl || 'https://api.openai.com/v1';
        this.instances.set(conf.id, new OpenAICompatibleProvider(conf.id, conf.name, baseUrl, conf.apiKey || ''));
      }
    }
  }

  getProvider(providerId: string): IAIProvider | undefined {
    return this.instances.get(providerId);
  }

  async testConnection(providerId: string, apiKey?: string, baseUrl?: string, model?: string): Promise<{ success: boolean; error?: string }> {
    const configs = appStore.getProviders();
    const conf = configs.find((c) => c.id === providerId);
    if (!conf) return { success: false, error: 'Provider not found' };

    const key = apiKey ?? conf.apiKey ?? '';
    const url = baseUrl ?? conf.baseUrl ?? '';

    if (conf.type === 'gemini') {
      const p = new GeminiProvider(key);
      return p.testConnection(key, url, model || conf.models[0]?.id);
    } else if (conf.type === 'anthropic') {
      const p = new AnthropicProvider(key);
      return p.testConnection(key, url, model || conf.models[0]?.id);
    } else {
      const p = new OpenAICompatibleProvider(conf.id, conf.name, url, key);
      return p.testConnection(key, url, model || conf.models[0]?.id);
    }
  }

  resolveAutoModel(profile: 'quality' | 'balanced' | 'cost' | 'fast'): { providerId: string; modelId: string } {
    const configs = appStore.getProviders().filter((p) => p.enabled && (p.apiKey || p.type === 'ollama'));
    if (configs.length === 0) {
      return { providerId: 'deepseek', modelId: 'deepseek-chat' };
    }

    if (profile === 'quality') {
      // Prefer Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Gemini Pro
      for (const p of configs) {
        const topModel = p.models.find((m) => m.supportsReasoning || m.name.includes('Sonnet') || m.name.includes('GPT-4o'));
        if (topModel) return { providerId: p.id, modelId: topModel.id };
      }
    } else if (profile === 'cost' || profile === 'fast') {
      // Prefer Ollama, Gemini Flash, GPT-4o mini, DeepSeek V3
      for (const p of configs) {
        const cheapModel = p.models.find((m) => (m.inputPricePerMillion ?? 99) < 0.2 || p.type === 'ollama');
        if (cheapModel) return { providerId: p.id, modelId: cheapModel.id };
      }
    }

    // Default first available model
    const first = configs[0];
    return { providerId: first.id, modelId: first.models[0]?.id || 'default' };
  }
}

export const providerManager = new ProviderManager();
