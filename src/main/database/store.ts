import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AppSettings, ProviderConfig, Checkpoint, UsageRecord } from '../../shared/types';
import { keyStorage } from '../security/key-storage';

export class AppDataStore {
  private dataDir: string;
  private settingsFile: string;
  private providersFile: string;
  private checkpointsDir: string;
  private usageFile: string;
  private sessionsDir: string;

  constructor() {
    try {
      this.dataDir = path.join(app.getPath('userData'), 'D4IDE_DATA');
    } catch {
      // Fallback if app is not ready yet or running in node test
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      this.dataDir = path.join(appData, 'D4IDE', 'D4IDE_DATA');
    }

    this.settingsFile = path.join(this.dataDir, 'settings.json');
    this.providersFile = path.join(this.dataDir, 'providers.json');
    this.usageFile = path.join(this.dataDir, 'usage.json');
    this.checkpointsDir = path.join(this.dataDir, 'checkpoints');
    this.sessionsDir = path.join(this.dataDir, 'sessions');

    this.ensureDirs();
  }

  private ensureDirs() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.checkpointsDir)) fs.mkdirSync(this.checkpointsDir, { recursive: true });
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  getSettings(): AppSettings {
    const defaultSettings: AppSettings = {
      language: 'th',
      theme: 'd4-dark',
      fontSize: 14,
      permissionMode: 'safe',
      defaultMode: 'build',
      autoRunTests: true,
      autoRunBuild: true,
      maxAgentSteps: 30,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-chat',
      reasoningEffort: 'medium',
      dailyBudget: 5,
      monthlyBudget: 50,
      perRequestBudget: 0.5,
      recentProjects: [],
      firstRunComplete: false
    };

    try {
      if (fs.existsSync(this.settingsFile)) {
        const data = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        return { ...defaultSettings, ...data };
      }
    } catch (e) {
      console.error('Failed to read settings:', e);
    }
    return defaultSettings;
  }

  saveSettings(settings: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    fs.writeFileSync(this.settingsFile, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  getProviders(): ProviderConfig[] {
    const defaultProviders: ProviderConfig[] = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        enabled: true,
        baseUrl: 'https://api.deepseek.com/v1',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek V3', providerId: 'deepseek', supportsTools: true, supportsVision: false, supportsReasoning: false, inputPricePerMillion: 0.14, outputPricePerMillion: 0.28 },
          { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoning)', providerId: 'deepseek', supportsTools: true, supportsVision: false, supportsReasoning: true, inputPricePerMillion: 0.55, outputPricePerMillion: 2.19 }
        ]
      },
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        models: [
          { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', supportsTools: true, supportsVision: true, supportsReasoning: false, inputPricePerMillion: 2.5, outputPricePerMillion: 10 },
          { id: 'gpt-4o-mini', name: 'GPT-4o mini', providerId: 'openai', supportsTools: true, supportsVision: true, supportsReasoning: false, inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
          { id: 'o3-mini', name: 'o3-mini (Reasoning)', providerId: 'openai', supportsTools: true, supportsVision: false, supportsReasoning: true, inputPricePerMillion: 1.1, outputPricePerMillion: 4.4 }
        ]
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        type: 'gemini',
        enabled: true,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: [
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', providerId: 'gemini', supportsTools: true, supportsVision: true, supportsReasoning: true, inputPricePerMillion: 0.075, outputPricePerMillion: 0.3 },
          { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerId: 'gemini', supportsTools: true, supportsVision: true, supportsReasoning: true, inputPricePerMillion: 1.25, outputPricePerMillion: 5.0 }
        ]
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1',
        models: [
          { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', providerId: 'anthropic', supportsTools: true, supportsVision: true, supportsReasoning: true, inputPricePerMillion: 3, outputPricePerMillion: 15 },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', providerId: 'anthropic', supportsTools: true, supportsVision: false, supportsReasoning: false, inputPricePerMillion: 0.8, outputPricePerMillion: 4 }
        ]
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        type: 'openrouter',
        enabled: false,
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [
          { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', providerId: 'openrouter', supportsTools: true, supportsVision: false, supportsReasoning: true },
          { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', providerId: 'openrouter', supportsTools: true, supportsVision: true, supportsReasoning: true }
        ]
      },
      {
        id: 'ollama',
        name: 'Ollama (Local)',
        type: 'ollama',
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        models: [
          { id: 'qwen2.5-coder:7b', name: 'Qwen 2.5 Coder 7B', providerId: 'ollama', supportsTools: true, supportsVision: false, supportsReasoning: false, inputPricePerMillion: 0, outputPricePerMillion: 0 },
          { id: 'deepseek-r1:8b', name: 'DeepSeek R1 8B', providerId: 'ollama', supportsTools: true, supportsVision: false, supportsReasoning: true, inputPricePerMillion: 0, outputPricePerMillion: 0 }
        ]
      }
    ];

    try {
      if (fs.existsSync(this.providersFile)) {
        const stored: ProviderConfig[] = JSON.parse(fs.readFileSync(this.providersFile, 'utf8'));
        // Decrypt API keys
        return stored.map((p) => {
          let apiKey = '';
          if (p.apiKey) {
            apiKey = keyStorage.decrypt(p.apiKey);
          }
          return { ...p, apiKey };
        });
      }
    } catch (e) {
      console.error('Failed to read providers:', e);
    }
    return defaultProviders;
  }

  saveProviders(providers: ProviderConfig[]): void {
    // Encrypt sensitive keys before saving
    const toSave = providers.map((p) => {
      let encryptedKey = '';
      if (p.apiKey) {
        encryptedKey = keyStorage.encrypt(p.apiKey);
      }
      return { ...p, apiKey: encryptedKey };
    });
    fs.writeFileSync(this.providersFile, JSON.stringify(toSave, null, 2), 'utf8');
  }

  saveUsage(record: UsageRecord): void {
    try {
      let records: UsageRecord[] = [];
      if (fs.existsSync(this.usageFile)) {
        records = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      }
      records.push(record);
      // Keep last 5000 records
      if (records.length > 5000) records = records.slice(-5000);
      fs.writeFileSync(this.usageFile, JSON.stringify(records, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to save usage record:', e);
    }
  }

  getUsageRecords(): UsageRecord[] {
    try {
      if (fs.existsSync(this.usageFile)) {
        return JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to get usage records:', e);
    }
    return [];
  }

  saveCheckpoint(checkpoint: Checkpoint): void {
    const file = path.join(this.checkpointsDir, `${checkpoint.id}.json`);
    fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2), 'utf8');
  }

  getCheckpoints(): Checkpoint[] {
    try {
      const files = fs.readdirSync(this.checkpointsDir).filter((f) => f.endsWith('.json'));
      return files
        .map((f) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.checkpointsDir, f), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('Failed to list checkpoints:', e);
      return [];
    }
  }

  getCheckpointById(id: string): Checkpoint | null {
    const file = path.join(this.checkpointsDir, `${id}.json`);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return null;
  }
}

export const appStore = new AppDataStore();
