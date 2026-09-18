import { create } from 'zustand';
import { AppSettings, ProviderConfig } from '../../shared/types';
import i18n from '../lib/i18n';

interface SettingsState {
  settings: AppSettings | null;
  providers: ProviderConfig[];
  isLoaded: boolean;

  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  saveProviders: (providers: ProviderConfig[]) => Promise<void>;
  /** Replace the provider list from an IPC response (already sanitized). */
  applyProviders: (providers: ProviderConfig[]) => void;
  toggleFavoriteModel: (key: string) => Promise<void>;
  pushRecentModel: (key: string) => Promise<void>;
  setLanguage: (lang: 'th' | 'en') => Promise<void>;
}

/** `providerId::modelId` key used for favourites and recents. */
export const modelKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  providers: [],
  isLoaded: false,

  loadSettings: async () => {
    if (!window.electronAPI) return;
    try {
      const settings = await window.electronAPI.getSettings();
      const providers = await window.electronAPI.getProviders();

      if (settings.language) i18n.changeLanguage(settings.language);

      set({ settings, providers, isLoaded: true });
    } catch (e) {
      console.error('Failed loading settings:', e);
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    if (!window.electronAPI) return;
    try {
      const updated = await window.electronAPI.updateSettings(partial);
      if (partial.language) i18n.changeLanguage(partial.language);
      set({ settings: updated });
    } catch (e) {
      console.error('Failed updating settings:', e);
    }
  },

  saveProviders: async (providers: ProviderConfig[]) => {
    if (!window.electronAPI) return;
    try {
      const sanitized: ProviderConfig[] = await window.electronAPI.saveProviders(providers);
      set({ providers: sanitized });
    } catch (e) {
      console.error('Failed saving providers:', e);
    }
  },

  applyProviders: (providers: ProviderConfig[]) => set({ providers }),

  toggleFavoriteModel: async (key: string) => {
    const settings = get().settings;
    if (!settings) return;
    const favorites = settings.favoriteModels || [];
    const next = favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key];
    await get().updateSettings({ favoriteModels: next });
  },

  pushRecentModel: async (key: string) => {
    const settings = get().settings;
    if (!settings) return;
    const recents = [key, ...(settings.recentModels || []).filter((k) => k !== key)].slice(0, 6);
    await get().updateSettings({ recentModels: recents });
  },

  setLanguage: async (lang: 'th' | 'en') => {
    await get().updateSettings({ language: lang });
  }
}));
