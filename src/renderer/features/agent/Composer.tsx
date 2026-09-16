import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Sparkles, Paperclip, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { AgentMode } from '../../../shared/types';

export const Composer: React.FC = () => {
  const { t } = useTranslation();
  const { mode, status, prompt, setPrompt, setMode, startAgent, cancelAgent } = useAgentStore();
  const { settings, providers, updateSettings } = useSettingsStore();

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showReasoningPicker, setShowReasoningPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isRunning = status === 'running' || status === 'planning';

  // Handle textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isRunning && prompt.trim()) {
        startAgent();
      }
    }
  };

  const handleSelectModel = (providerId: string, modelId: string) => {
    updateSettings({ activeProviderId: providerId, activeModelId: modelId });
    setShowModelPicker(false);
  };

  const handleSelectReasoning = (level: any) => {
    updateSettings({ reasoningEffort: level });
    setShowReasoningPicker(false);
  };

  const currentProvider = providers.find((p) => p.id === settings?.activeProviderId);
  const currentModel = currentProvider?.models.find((m) => m.id === settings?.activeModelId);

  return (
    <div className="border-t border-d4-border bg-d4-panel p-3">
      <div className="bg-d4-surface border border-d4-border rounded-md shadow-lg overflow-hidden transition-all focus-within:border-d4-accent/60">
        {/* Input box */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.inputPlaceholder')}
          rows={2}
          className="w-full bg-transparent px-3 py-2.5 text-sm text-d4-text placeholder-d4-dimmed outline-none resize-none font-sans"
        />

        {/* Toolbar & Selectors */}
        <div className="flex items-center justify-between px-3 py-2 bg-d4-subtle/40 border-t border-d4-border/40 text-xs select-none">
          {/* Left: Mode Toggle & Model Pickers */}
          <div className="flex items-center space-x-2">
            {/* Mode: Plan vs Build */}
            <div className="flex items-center bg-d4-panel border border-d4-border rounded-sm p-0.5">
              <button
                type="button"
                onClick={() => setMode('plan')}
                className={`px-2 py-0.5 rounded-sm transition-all font-medium ${
                  mode === 'plan' ? 'bg-amber-500/20 text-amber-400' : 'text-d4-dimmed hover:text-d4-muted'
                }`}
                title={t('agent.planModeDesc')}
              >
                {t('agent.planMode')}
              </button>
              <button
                type="button"
                onClick={() => setMode('build')}
                className={`px-2 py-0.5 rounded-sm transition-all font-medium ${
                  mode === 'build' ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-dimmed hover:text-d4-muted'
                }`}
                title={t('agent.buildModeDesc')}
              >
                {t('agent.buildMode')}
              </button>
            </div>

            {/* Model Selector Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center space-x-1 px-2 py-1 bg-d4-panel hover:bg-d4-surface border border-d4-border rounded-sm text-d4-muted hover:text-d4-text"
              >
                <Sparkles className="w-3 h-3 text-d4-accent" />
                <span className="truncate max-w-[130px]">{currentModel?.name || settings?.activeModelId || 'Select Model'}</span>
                <ChevronDown className="w-3 h-3 text-d4-dimmed" />
              </button>

              {showModelPicker && (
                <div className="absolute bottom-full mb-1 left-0 w-64 max-h-72 overflow-y-auto bg-d4-panel border border-d4-border rounded-md shadow-2xl p-1 z-50">
                  <div className="text-[10px] uppercase font-semibold text-d4-dimmed px-2 py-1">AI Providers & Models</div>
                  {providers
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <div key={p.id} className="mb-1">
                        <div className="text-[11px] font-bold text-d4-muted px-2 py-0.5">{p.name}</div>
                        {p.models.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => handleSelectModel(p.id, m.id)}
                            className={`w-full text-left px-2.5 py-1 rounded text-xs flex items-center justify-between ${
                              settings?.activeModelId === m.id
                                ? 'bg-d4-accent/20 text-d4-accent font-medium'
                                : 'text-d4-text hover:bg-d4-surface'
                            }`}
                          >
                            <span className="truncate">{m.name}</span>
                            {settings?.activeModelId === m.id && <Check className="w-3 h-3" />}
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Reasoning Effort Selector */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowReasoningPicker(!showReasoningPicker)}
                className="flex items-center space-x-1 px-2 py-1 bg-d4-panel hover:bg-d4-surface border border-d4-border rounded-sm text-d4-muted hover:text-d4-text"
                title="Reasoning Effort"
              >
                <span className="text-[11px] text-d4-dimmed">Reason:</span>
                <span className="capitalize">{settings?.reasoningEffort || 'medium'}</span>
                <ChevronDown className="w-3 h-3 text-d4-dimmed" />
              </button>

              {showReasoningPicker && (
                <div className="absolute bottom-full mb-1 left-0 w-32 bg-d4-panel border border-d4-border rounded-md shadow-2xl p-1 z-50">
                  {['off', 'low', 'medium', 'high', 'auto'].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => handleSelectReasoning(lvl)}
                      className={`w-full text-left px-2 py-1 rounded text-xs capitalize flex items-center justify-between ${
                        settings?.reasoningEffort === lvl ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-text hover:bg-d4-surface'
                      }`}
                    >
                      <span>{lvl}</span>
                      {settings?.reasoningEffort === lvl && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Send / Stop Action */}
          <div className="flex items-center space-x-2">
            {isRunning ? (
              <button
                type="button"
                onClick={cancelAgent}
                className="flex items-center space-x-1 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-sm font-medium transition-colors"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>{t('agent.stop')}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!prompt.trim()}
                onClick={() => startAgent()}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-sm font-medium transition-all ${
                  prompt.trim()
                    ? 'bg-d4-accent hover:bg-d4-accent-hover text-black font-semibold'
                    : 'bg-d4-subtle text-d4-dimmed cursor-not-allowed'
                }`}
              >
                <span>{t('agent.send')}</span>
                <Send className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
