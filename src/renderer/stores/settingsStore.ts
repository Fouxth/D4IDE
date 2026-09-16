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
  setLanguage: (lang: 'th' | 'en') => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  providers: [],
  isLoaded: false,

  loadSettings: async () => {
    if (!window.electronAPI) return;
    try {
      const settings = await window.electronAPI.getSettings();
      const providers = await window.electronAPI.getProviders();

      if (settings.language) {
        i18n.changeLanguage(settings.language);
      }

      set({ settings, providers, isLoaded: true });
    } catch (e) {
      console.error('Failed loading settings:', e);
    }
  },

  updateSettings: async (partial: Partial<AppSettings>) => {
    if (!window.electronAPI) return;
    try {
      const updated = await window.electronAPI.updateSettings(partial);
      if (partial.language) {
        i18n.changeLanguage(partial.language);
      }
      set({ settings: updated });
    } catch (e) {
      console.error('Failed updating settings:', e);
    }
  },

  saveProviders: async (providers: ProviderConfig[]) => {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.saveProviders(providers);
      set({ providers });
    } catch (e) {
      console.error('Failed saving providers:', e);
    }
  },

  setLanguage: async (lang: 'th' | 'en') => {
    await get().updateSettings({ language: lang });
  }
}));
