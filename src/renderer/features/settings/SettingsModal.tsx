import React, { useState } from 'react';
import { X, Globe, Shield, Cpu, Key, DollarSign, Plus, Check, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { PermissionMode, ProviderConfig } from '../../../shared/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { settings, providers, updateSettings, saveProviders, setLanguage } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<'language' | 'providers' | 'permissions' | 'agent' | 'budgets'>('language');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; error?: string } | null>(null);
  const [localProviders, setLocalProviders] = useState<ProviderConfig[]>([]);

  // Sync providers on open
  React.useEffect(() => {
    if (providers) {
      setLocalProviders(JSON.parse(JSON.stringify(providers)));
    }
  }, [providers, isOpen]);

  if (!isOpen || !settings) return null;

  const handleApiKeyChange = (id: string, key: string) => {
    setLocalProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey: key, enabled: true } : p))
    );
  };

  const handleBaseUrlChange = (id: string, url: string) => {
    setLocalProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, baseUrl: url } : p))
    );
  };

  const handleTestConnection = async (p: ProviderConfig) => {
    setTestingId(p.id);
    setTestResult(null);
    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.testProvider(p.id, p.apiKey, p.baseUrl, p.models[0]?.id);
        setTestResult({ id: p.id, success: res.success, error: res.error });
      }
    } catch (e: any) {
      setTestResult({ id: p.id, success: false, error: e.message });
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveProviders = async () => {
    await saveProviders(localProviders);
    alert('Providers saved successfully!');
  };

  const handleAddCustomProvider = () => {
    const id = `custom_${Date.now()}`;
    const newP: ProviderConfig = {
      id,
      name: 'Custom Provider',
      type: 'custom',
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      isCustom: true,
      models: [
        {
          id: 'custom-model',
          name: 'Custom Model',
          providerId: id,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: false
        }
      ]
    };
    setLocalProviders([...localProviders, newP]);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center select-none text-xs">
      <div className="w-[780px] h-[580px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-d4-border bg-d4-bg/50">
          <span className="font-semibold text-d4-text text-sm">{t('settings.title')}</span>
          <button onClick={onClose} className="text-d4-dimmed hover:text-d4-text rounded p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body with Left Categories & Right Panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Category Menu */}
          <div className="w-48 bg-d4-bg border-r border-d4-border p-2 space-y-1">
            {[
              { id: 'language', label: t('settings.language'), icon: Globe },
              { id: 'providers', label: t('settings.providers'), icon: Key },
              { id: 'permissions', label: t('settings.permissions'), icon: Shield },
              { id: 'agent', label: t('settings.agentSettings'), icon: Cpu },
              { id: 'budgets', label: t('settings.budgets'), icon: DollarSign }
            ].map((cat) => {
              const Icon = cat.icon;
              const isActive = activeTab === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id as any)}
                  className={`w-full flex items-center space-x-2 px-3 py-2 rounded-sm transition-colors text-left ${
                    isActive ? 'bg-d4-surface text-d4-accent font-medium' : 'text-d4-muted hover:text-d4-text hover:bg-d4-surface/40'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right Content Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-6">
            {/* --- LANGUAGE TAB --- */}
            {activeTab === 'language' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.language')}</h3>
                <p className="text-d4-muted text-xs leading-relaxed">
                  เลือกภาษาสำหรับส่วนติดต่อผู้ใช้ / Choose application UI language.
                </p>

                <div className="space-y-2 max-w-sm pt-2">
                  <label
                    onClick={() => setLanguage('th')}
                    className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-all ${
                      settings.language === 'th'
                        ? 'border-d4-accent bg-d4-accent/10 text-d4-text font-medium'
                        : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                    }`}
                  >
                    <span>{t('settings.languageThai')}</span>
                    {settings.language === 'th' && <Check className="w-4 h-4 text-d4-accent" />}
                  </label>

                  <label
                    onClick={() => setLanguage('en')}
                    className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-all ${
                      settings.language === 'en'
                        ? 'border-d4-accent bg-d4-accent/10 text-d4-text font-medium'
                        : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                    }`}
                  >
                    <span>{t('settings.languageEnglish')}</span>
                    {settings.language === 'en' && <Check className="w-4 h-4 text-d4-accent" />}
                  </label>
                </div>
              </div>
            )}

            {/* --- PROVIDERS TAB --- */}
            {activeTab === 'providers' && (
              <div className="space-y-4 select-text">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-d4-text">{t('settings.providers')}</h3>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleAddCustomProvider}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-d4-surface border border-d4-border hover:bg-d4-subtle text-d4-text rounded-sm text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('settings.addCustomProvider')}</span>
                    </button>
                    <button
                      onClick={handleSaveProviders}
                      className="px-3 py-1 bg-d4-accent hover:bg-d4-accent-hover text-black font-semibold rounded-sm text-xs"
                    >
                      {t('settings.save')}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {localProviders.map((p) => (
                    <div key={p.id} className="bg-d4-surface border border-d4-border rounded-md p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-d4-text text-xs">{p.name}</span>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleTestConnection(p)}
                            disabled={testingId === p.id}
                            className="flex items-center space-x-1 px-2 py-0.5 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
                          >
                            {testingId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            <span>{t('settings.testConnection')}</span>
                          </button>
                        </div>
                      </div>

                      {/* API Key field (for non-Ollama) */}
                      {p.type !== 'ollama' && (
                        <div>
                          <label className="text-[10px] text-d4-dimmed uppercase block mb-1">API Key</label>
                          <input
                            type="password"
                            value={p.apiKey || ''}
                            onChange={(e) => handleApiKeyChange(p.id, e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-d4-panel border border-d4-border rounded px-2.5 py-1.5 text-xs text-d4-text outline-none font-mono focus:border-d4-accent"
                          />
                        </div>
                      )}

                      {/* Base URL field */}
                      <div>
                        <label className="text-[10px] text-d4-dimmed uppercase block mb-1">Base URL</label>
                        <input
                          type="text"
                          value={p.baseUrl || ''}
                          onChange={(e) => handleBaseUrlChange(p.id, e.target.value)}
                          className="w-full bg-d4-panel border border-d4-border rounded px-2.5 py-1.5 text-xs text-d4-text outline-none font-mono focus:border-d4-accent"
                        />
                      </div>

                      {/* Test Result Message */}
                      {testResult?.id === p.id && (
                        <div
                          className={`text-[11px] p-2 rounded flex items-center space-x-1.5 ${
                            testResult.success
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {testResult.success ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                          <span>{testResult.success ? t('settings.testSuccess') : `${t('settings.testFailed')}: ${testResult.error}`}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* --- PERMISSIONS TAB --- */}
            {activeTab === 'permissions' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.permissionMode')}</h3>
                <div className="space-y-2.5">
                  {(['safe', 'ask', 'full'] as PermissionMode[]).map((mode) => (
                    <label
                      key={mode}
                      onClick={() => updateSettings({ permissionMode: mode })}
                      className={`block p-3 rounded border cursor-pointer transition-all ${
                        settings.permissionMode === mode
                          ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                          : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold capitalize text-xs">{mode}</span>
                        {settings.permissionMode === mode && <Check className="w-4 h-4 text-d4-accent" />}
                      </div>
                      <p className="text-[11px] text-d4-dimmed">
                        {mode === 'safe' && t('settings.permissionSafe')}
                        {mode === 'ask' && t('settings.permissionAsk')}
                        {mode === 'full' && t('settings.permissionFull')}
                      </p>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* --- AGENT TAB --- */}
            {activeTab === 'agent' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.agentSettings')}</h3>
                <div className="space-y-3 max-w-md">
                  <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
                    <span>{t('settings.autoRunTests')}</span>
                    <input
                      type="checkbox"
                      checked={settings.autoRunTests}
                      onChange={(e) => updateSettings({ autoRunTests: e.target.checked })}
                      className="accent-teal-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
                    <span>{t('settings.autoRunBuild')}</span>
                    <input
                      type="checkbox"
                      checked={settings.autoRunBuild}
                      onChange={(e) => updateSettings({ autoRunBuild: e.target.checked })}
                      className="accent-teal-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  <div className="p-2.5 bg-d4-surface border border-d4-border rounded flex items-center justify-between">
                    <span>{t('settings.maxAgentSteps')}</span>
                    <input
                      type="number"
                      value={settings.maxAgentSteps}
                      onChange={(e) => updateSettings({ maxAgentSteps: parseInt(e.target.value) || 30 })}
                      className="w-16 bg-d4-panel border border-d4-border rounded px-2 py-1 text-xs text-d4-text text-right outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* --- BUDGETS TAB --- */}
            {activeTab === 'budgets' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.budgets')}</h3>
                <div className="space-y-3 max-w-md">
                  <div className="p-2.5 bg-d4-surface border border-d4-border rounded flex items-center justify-between">
                    <span>Daily Budget ($)</span>
                    <input
                      type="number"
                      step="0.5"
                      value={settings.dailyBudget}
                      onChange={(e) => updateSettings({ dailyBudget: parseFloat(e.target.value) || 5 })}
                      className="w-20 bg-d4-panel border border-d4-border rounded px-2 py-1 text-xs text-d4-text text-right outline-none font-mono"
                    />
                  </div>
                  <div className="p-2.5 bg-d4-surface border border-d4-border rounded flex items-center justify-between">
                    <span>Monthly Budget ($)</span>
                    <input
                      type="number"
                      step="5"
                      value={settings.monthlyBudget}
                      onChange={(e) => updateSettings({ monthlyBudget: parseFloat(e.target.value) || 50 })}
                      className="w-20 bg-d4-panel border border-d4-border rounded px-2 py-1 text-xs text-d4-text text-right outline-none font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
