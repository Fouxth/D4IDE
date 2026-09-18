import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Square,
  Sparkles,
  ChevronDown,
  Check,
  Search,
  Wrench,
  Image as ImageIcon,
  Zap,
  Star,
  Database,
  Shield,
  ListPlus,
  Paperclip,
  X,
  ArrowUp,
  Settings2,
  Slash
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useSettingsStore, modelKey } from '../../stores/settingsStore';
import { useQueueStore } from '../../stores/queueStore';
import { useUsageStore } from '../../stores/usageStore';
import { toast } from '../../stores/toastStore';
import { ModelInfo, ProviderConfig, PromptImage, SkillItem } from '../../../shared/types';
import { BUILTIN_COMMANDS, expandCommandPrompt } from '../../../shared/builtin-commands';
import { useProjectStore } from '../../stores/projectStore';
import { formatPrice, formatTokens, formatUsd } from '../../lib/format';

/** How many commands the `/` menu shows at once. */
const COMMAND_LIMIT = 8;

/** A leading slash starts a command; everything after it is the user's detail. */
const parseCommand = (text: string): { query: string; rest: string } | null => {
  const match = /^\/([a-z0-9-]*)[ \t]*([\s\S]*)$/i.exec(text);
  if (!match) return null;
  return { query: match[1].toLowerCase(), rest: match[2] };
};

const ROUTING_PROFILES = ['quality', 'balanced', 'cost', 'fast'] as const;

/** Vision models are the only ones that get images; anything else is text-only. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const ModelBadges: React.FC<{ model: ModelInfo }> = ({ model }) => (
  <span className="flex items-center space-x-1 shrink-0">
    {model.supportsTools && (
      <span title="Tools">
        <Wrench className="w-3 h-3 text-d4-muted" />
      </span>
    )}
    {model.supportsVision && (
      <span title="Vision">
        <ImageIcon className="w-3 h-3 text-d4-muted" />
      </span>
    )}
    {model.supportsReasoning && (
      <span title="Reasoning">
        <Zap className="w-3 h-3 text-amber-400" />
      </span>
    )}
    {model.supportsCaching && (
      <span title="Prompt caching">
        <Database className="w-3 h-3 text-blue-400" />
      </span>
    )}
  </span>
);

const readAsImage = (file: File): Promise<PromptImage | null> =>
  new Promise((resolve) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_ATTACHMENT_BYTES) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      resolve({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name || 'clipboard-image',
        mimeType: file.type,
        data: base64,
        bytes: file.size
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

/**
 * The composer, laid out the way a chat client does it (spec §13).
 *
 * Inside the rounded box: the prompt, the run mode (Build / Plan) and the two
 * attachment actions. Below the box: everything that is a *setting* rather than
 * a per-message choice — provider/model, reasoning effort, permission level and
 * the running session cost. Nothing here is a timer: usage is measured in
 * tokens and money, and a run is never cut off by the clock.
 */
export const Composer: React.FC<{
  onOpenSettings?: (tab?: string) => void;
  /** `/design` opens the project style page rather than inserting a paragraph. */
  onOpenDesign?: () => void;
}> = ({ onOpenSettings, onOpenDesign }) => {
  const { t } = useTranslation();
  const { mode, status, prompt, setPrompt, setMode, startAgent, cancelAgent } = useAgentStore();
  const { settings, providers, updateSettings, toggleFavoriteModel, pushRecentModel } = useSettingsStore();
  const { addItem } = useQueueStore();
  const { summary } = useUsageStore();

  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showReasoningPicker, setShowReasoningPicker] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const reasoningPickerRef = useRef<HTMLDivElement>(null);
  const [modelQuery, setModelQuery] = useState('');
  const [images, setImages] = useState<PromptImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projectPath = useProjectStore((state) => state.projectPath);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);

  const isRunning = status === 'running' || status === 'planning' || status === 'waiting_approval';
  const isAuto = settings?.activeProviderId === 'auto' || settings?.activeModelId === 'auto';

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [prompt]);

  // A popup that cannot be dismissed is a trap: it sits over the message box,
  // so every click meant for the input lands on the popup instead and the app
  // looks frozen. Escape and a click anywhere outside the picker close it —
  // including a click in the message box, which is what the user meant to hit.
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        setShowModelPicker(false);
        setShowReasoningPicker(false);
        return;
      }
      const target = event.target as Node;
      if (!modelPickerRef.current?.contains(target)) setShowModelPicker(false);
      if (!reasoningPickerRef.current?.contains(target)) setShowReasoningPicker(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  // The shipped commands plus the user's own skills, refreshed when the project
  // changes because project skills live inside the project folder.
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI
      .listSkills(projectPath || undefined)
      .then((list) => setSkills((list ?? []) as SkillItem[]))
      .catch(() => undefined);
  }, [projectPath]);

  const parsedCommand = parseCommand(prompt);
  const commandMatches =
    parsedCommand && !commandDismissed
      ? skills
          .filter(
            (skill) =>
              !parsedCommand.query ||
              skill.id.toLowerCase().startsWith(parsedCommand.query) ||
              skill.name.toLowerCase().startsWith(parsedCommand.query)
          )
          .slice(0, COMMAND_LIMIT)
      : [];
  const menuOpen = commandMatches.length > 0;

  /**
   * Puts a command's prompt in the box with the user's own words appended, and
   * switches to the mode the command needs. The text stays editable and is never
   * sent on its own, so choosing a command cannot start a run by surprise.
   */
  const applyCommand = (skill: SkillItem) => {
    const builtin = BUILTIN_COMMANDS.find((entry) => entry.id === skill.id);
    const detail = parsedCommand?.rest ?? '';

    setCommandDismissed(true);
    setCommandIndex(0);

    // Commands whose whole point is a setting have to actually change it.
    // `/thrift` used to be a paragraph asking the model to be careful: it made
    // the prompt longer and saved nothing. Now it moves the engine's dials, and
    // there is no half-typed request left in the box afterwards.
    const action = builtin?.action;
    if (action === 'toggle-thrift' || action === 'set-thrift-on' || action === 'set-thrift-off') {
      const enabling = action === 'set-thrift-on' || (action === 'toggle-thrift' && !settings?.thriftMode);
      // Through the store, not the raw IPC: the status-bar badge and the
      // Settings checkbox read the store, so bypassing it would flip the engine
      // while every indicator on screen still said the old value.
      void updateSettings({ thriftMode: enabling });
      setPrompt(detail ? `${detail} ` : '');
      toast.info(enabling ? t('tokenMeter.thriftToastOn') : t('tokenMeter.thriftToastOff'));
      textareaRef.current?.focus();
      return;
    }
    if (action === 'open-design') {
      setPrompt(detail ? `${detail} ` : '');
      onOpenDesign?.();
      toast.info(t('tokenMeter.designOpened'));
      textareaRef.current?.focus();
      return;
    }

    const body = builtin ? expandCommandPrompt(builtin, detail) : `${skill.content}${detail ? `\n\n${detail}` : ''}`;
    setPrompt(`${body} `);
    if (builtin?.mode) setMode(builtin.mode);
    textareaRef.current?.focus();
  };

  const usableProviders = useMemo(
    () => providers.filter((p) => p.enabled && (!p.requiresApiKey || p.hasApiKey) && p.models.length > 0),
    [providers]
  );

  const currentProvider = providers.find((p) => p.id === settings?.activeProviderId);
  const currentModel = currentProvider?.models.find((m) => m.id === settings?.activeModelId);
  const showReasoning = isAuto || !!currentModel?.supportsReasoning;
  const canSeeImages = isAuto || !!currentModel?.supportsVision;

  const filteredProviders = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const matches = (m: ModelInfo) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    return usableProviders
      .map((p) => ({ provider: p, models: p.models.filter(matches) }))
      .filter((entry) => entry.models.length > 0 || (!q && entry.provider.models.length > 0));
  }, [usableProviders, modelQuery]);

  const favoriteKeys = settings?.favoriteModels || [];
  const recentKeys = settings?.recentModels || [];

  const attach = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, MAX_ATTACHMENTS - images.length);
    const loaded = (await Promise.all(list.map(readAsImage))).filter((image): image is PromptImage => !!image);
    if (loaded.length === 0) {
      toast.error(t('agent.imageRejected'), t('agent.imageRejectedHint'));
      return;
    }
    setImages((prev) => [...prev, ...loaded].slice(0, MAX_ATTACHMENTS));
  };

  const handleSelectModel = async (providerId: string, modelId: string) => {
    await updateSettings({ activeProviderId: providerId, activeModelId: modelId });
    await pushRecentModel(modelKey(providerId, modelId));
    setShowModelPicker(false);
    setModelQuery('');
  };

  const handleSelectAuto = async () => {
    await updateSettings({ activeProviderId: 'auto', activeModelId: 'auto' });
    setShowModelPicker(false);
    setModelQuery('');
    toast.info(t('agent.autoModelSelected'), t(`settings.routing_${settings?.routingProfile || 'balanced'}`));
  };

  const handleSelectRouting = async (profile: (typeof ROUTING_PROFILES)[number]) => {
    await updateSettings({ routingProfile: profile });
    if (window.electronAPI) {
      const decision = await window.electronAPI.resolveAutoModel(profile);
      toast.info(t('agent.autoRouteDecision', { model: decision.modelName }), decision.reason);
    }
  };

  const send = (targetMode?: 'plan' | 'build') => {
    if (!prompt.trim() && images.length === 0) return;
    if (targetMode) setMode(targetMode);
    if (isRunning) {
      addItem(prompt.trim(), targetMode || mode);
      toast.info(t('rightSidebar.queued'));
      setPrompt('');
      setImages([]);
      return;
    }
    void startAgent(undefined, images);
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The `/` menu owns the arrow keys and Enter while it is open.
    if (menuOpen) {
      const count = commandMatches.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandIndex((previous) => (previous + 1) % count);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandIndex((previous) => (previous - 1 + count) % count);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyCommand(commandMatches[Math.min(commandIndex, count - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandDismissed(true);
        return;
      }
    }

    if (e.key !== 'Enter') return;
    if (e.shiftKey) return; // newline
    e.preventDefault();
    if (isRunning) return send();
    // Ctrl/Cmd+Enter plans, plain Enter builds — the same gesture the spec lists.
    send(e.ctrlKey || e.metaKey ? 'plan' : 'build');
  };

  const renderModelRow = (provider: ProviderConfig, model: ModelInfo) => {
    const key = modelKey(provider.id, model.id);
    const isActive = settings?.activeProviderId === provider.id && settings?.activeModelId === model.id;
    const isFavorite = favoriteKeys.includes(key);
    return (
      <button
        key={key}
        type="button"
        onClick={() => handleSelectModel(provider.id, model.id)}
        className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between gap-2 group ${
          isActive ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-text hover:bg-d4-surface'
        }`}
      >
        <div className="flex items-center space-x-2 min-w-0">
          <span className="truncate text-xs">{model.name}</span>
          <ModelBadges model={model} />
        </div>
        <div className="flex items-center space-x-2 shrink-0 text-[10px] text-d4-dimmed font-mono">
          <span>{model.contextWindow ? formatTokens(model.contextWindow) : '—'}</span>
          <span>
            {formatPrice(model.inputPricePerMillion)}/{formatPrice(model.outputPricePerMillion)}
          </span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              toggleFavoriteModel(key);
            }}
            className="p-0.5"
            title={t('agent.favorite')}
          >
            <Star className={`w-3 h-3 ${isFavorite ? 'text-amber-400 fill-current' : 'text-d4-dimmed'}`} />
          </span>
          {isActive && <Check className="w-3 h-3" />}
        </div>
      </button>
    );
  };

  const favoriteModels = favoriteKeys
    .map((key) => {
      const [providerId, modelId] = key.split('::');
      const provider = providers.find((p) => p.id === providerId);
      const model = provider?.models.find((m) => m.id === modelId);
      return provider && model ? { provider, model } : null;
    })
    .filter((x): x is { provider: ProviderConfig; model: ModelInfo } => !!x);

  const hasContent = prompt.trim().length > 0 || images.length > 0;
  const sessionCost = summary?.session.cost ?? 0;
  const sessionTokens = (summary?.session.inputTokens ?? 0) + (summary?.session.outputTokens ?? 0);
  const permission = settings?.permissionMode || 'safe';

  const cyclePermission = () => {
    const order: Array<'safe' | 'ask' | 'full'> = ['safe', 'ask', 'full'];
    updateSettings({ permissionMode: order[(order.indexOf(permission) + 1) % order.length] });
  };

  return (
    <div className="relative shrink-0 bg-d4-bg px-4 pb-2 pt-1">
      <div
        className="w-full"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer?.files?.length) void attach(e.dataTransfer.files);
        }}
      >
        <div
          className={`relative rounded-2xl border bg-d4-panel transition-colors ${
            isDragging ? 'border-d4-accent' : 'border-d4-border focus-within:border-d4-muted'
          }`}
        >
          {menuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 z-30 max-h-72 overflow-y-auto rounded-lg border border-d4-border bg-d4-panel shadow-xl">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-d4-dimmed border-b border-d4-border/60">
                {t('agent.commands')}
              </div>
              {commandMatches.map((skill, index) => (
                <button
                  key={skill.id}
                  type="button"
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => applyCommand(skill)}
                  className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 ${
                    index === commandIndex ? 'bg-d4-surface' : ''
                  }`}
                >
                  <span className="font-mono text-[11px] text-d4-accent shrink-0">/{skill.id}</span>
                  <span className="text-[11px] text-d4-dimmed truncate">{skill.description}</span>
                  {!skill.isGlobal && (
                    <span className="ml-auto text-[9px] text-d4-dimmed shrink-0">{t('agent.projectCommand')}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {images.map((image) => (
                <div key={image.id} className="relative group">
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={image.name}
                    className="h-16 w-16 object-cover rounded-md border border-d4-border"
                  />
                  <button
                    onClick={() => setImages((prev) => prev.filter((entry) => entry.id !== image.id))}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-d4-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('common.remove')}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
              {!canSeeImages && (
                <div className="self-center text-[10px] text-d4-warning max-w-[180px] leading-tight">
                  {t('agent.visionNotSupported')}
                </div>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              // Typing after a command re-opens the menu, so a wrong pick is one
              // keystroke from being corrected.
              setCommandDismissed(false);
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.length > 0) {
                e.preventDefault();
                void attach(files);
              }
            }}
            placeholder={t('agent.inputPlaceholder')}
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-1 text-[13px] leading-relaxed text-d4-text placeholder-d4-dimmed outline-none resize-none"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => setMode('build')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  mode === 'build'
                    ? 'bg-d4-accent text-black'
                    : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface'
                }`}
                title={t('agent.buildModeDesc')}
              >
                {t('agent.buildMode')}
              </button>
              <button
                type="button"
                onClick={() => setMode('plan')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  mode === 'plan' ? 'bg-d4-warning/25 text-d4-warning' : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface'
                }`}
                title={t('agent.planModeDesc')}
              >
                {t('agent.planMode')}
              </button>

              <button
                type="button"
                onClick={() => {
                  setCommandDismissed(false);
                  if (!parseCommand(prompt)) setPrompt('/');
                  textareaRef.current?.focus();
                }}
                className="d4-icon-button w-7 h-7"
                title={t('agent.commandsHint')}
              >
                <Slash className="w-3.5 h-3.5" />
              </button>

              <label className="d4-icon-button w-7 h-7 cursor-pointer" title={t('agent.attachImage')}>
                <Paperclip className="w-3.5 h-3.5" />
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void attach(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>

              <label className="d4-icon-button w-7 h-7 cursor-pointer" title={t('agent.attachImage')}>
                <ImageIcon className="w-3.5 h-3.5" />
                <input
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void attach(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={!hasContent}
                onClick={() => send()}
                title={isRunning ? t('rightSidebar.addToQueue') : t('agent.queue')}
                className="d4-icon-button w-7 h-7 disabled:opacity-30"
              >
                <ListPlus className="w-3.5 h-3.5" />
              </button>

              {isRunning ? (
                <button
                  type="button"
                  onClick={cancelAgent}
                  title={t('agent.stop')}
                  className="flex items-center justify-center w-8 h-8 rounded-full bg-d4-error/15 hover:bg-d4-error/25 text-d4-error border border-d4-error/30 transition-colors"
                >
                  <Square className="w-3 h-3 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!hasContent}
                  onClick={() => send()}
                  title={`${t('agent.send')}  ·  Enter`}
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                    hasContent
                      ? 'bg-d4-accent hover:bg-d4-accent-hover text-black'
                      : 'bg-d4-surface text-d4-dimmed cursor-not-allowed'
                  }`}
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- footer */}
        <div className="mt-1.5 px-1 flex items-center justify-between gap-2 text-[11px] text-d4-dimmed">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-d4-muted font-medium shrink-0">{t('app.name')}</span>

            {/* The picker panel is anchored to the composer box, not to this
                chip, so opening it never covers the message the user is typing. */}
            <div className="min-w-0" ref={modelPickerRef}>
              <button
                type="button"
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1 max-w-[240px] px-1.5 py-0.5 rounded-sm hover:bg-d4-surface transition-colors"
              >
                <span className="truncate text-d4-muted">
                  {isAuto
                    ? `${t('agent.auto')} · ${t(`settings.routing_${settings?.routingProfile || 'balanced'}`)}`
                    : currentModel?.name || settings?.activeModelId || t('agent.selectModel')}
                </span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </button>

              {showModelPicker && (
                <div className="absolute bottom-full mb-1.5 left-4 w-[440px] max-h-80 bg-d4-panel border border-d4-border rounded-md shadow-2xl z-50 flex flex-col overflow-hidden">
                  <div className="p-2 border-b border-d4-border-subtle flex items-center space-x-2">
                    <Search className="w-3.5 h-3.5 text-d4-dimmed" />
                    <input
                      autoFocus
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder={t('agent.searchModels')}
                      className="flex-1 bg-transparent text-xs text-d4-text outline-none placeholder-d4-dimmed"
                    />
                  </div>

                  <div className="overflow-y-auto p-1">
                    <button
                      type="button"
                      onClick={handleSelectAuto}
                      className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between ${
                        isAuto ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-text hover:bg-d4-surface'
                      }`}
                    >
                      <span className="flex items-center space-x-2">
                        <Sparkles className="w-3.5 h-3.5 text-d4-accent" />
                        <span className="text-xs">{t('agent.autoModel')}</span>
                      </span>
                      {isAuto && <Check className="w-3 h-3" />}
                    </button>

                    <div className="flex items-center space-x-1 px-2 py-1">
                      {ROUTING_PROFILES.map((profile) => (
                        <button
                          key={profile}
                          type="button"
                          onClick={() => handleSelectRouting(profile)}
                          className={`px-2 py-0.5 rounded-sm text-[10px] ${
                            settings?.routingProfile === profile
                              ? 'bg-d4-accent/20 text-d4-accent'
                              : 'text-d4-dimmed hover:text-d4-text'
                          }`}
                        >
                          {t(`settings.routing_${profile}`)}
                        </button>
                      ))}
                    </div>

                    {favoriteModels.length > 0 && !modelQuery && (
                      <div className="mb-1">
                        <div className="d4-label px-2 py-1">{t('agent.favorites')}</div>
                        {favoriteModels.map(({ provider, model }) => renderModelRow(provider, model))}
                      </div>
                    )}

                    {recentKeys.length > 0 && !modelQuery && (
                      <div className="mb-1">
                        <div className="d4-label px-2 py-1">{t('agent.recent')}</div>
                        {recentKeys
                          .map((key) => {
                            const [providerId, modelId] = key.split('::');
                            const provider = providers.find((p) => p.id === providerId);
                            const model = provider?.models.find((m) => m.id === modelId);
                            return provider && model ? { provider, model } : null;
                          })
                          .filter((x): x is { provider: ProviderConfig; model: ModelInfo } => !!x)
                          .slice(0, 3)
                          .map(({ provider, model }) => renderModelRow(provider, model))}
                      </div>
                    )}

                    {filteredProviders.length === 0 ? (
                      <div className="text-center py-6 px-4 text-d4-dimmed text-[11px] space-y-2">
                        <div>{t('agent.noModels')}</div>
                        {onOpenSettings && (
                          <button
                            onClick={() => {
                              setShowModelPicker(false);
                              onOpenSettings('providers');
                            }}
                            className="text-d4-accent hover:underline"
                          >
                            {t('agent.connectProvider')}
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredProviders.map(({ provider, models }) => (
                        <div key={provider.id} className="mb-1">
                          <div className="d4-label px-2 py-1 flex items-center justify-between">
                            <span>{provider.name}</span>
                            <span className="text-d4-dimmed normal-case font-normal">
                              {provider.apiKeyPreview || t('providers.local')}
                            </span>
                          </div>
                          {models.map((m) => renderModelRow(provider, m))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {showReasoning && (
              // `relative` is load-bearing: the menu below is `absolute bottom-full`,
              // and without a positioned parent it anchored to a distant ancestor
              // and opened in the middle of the conversation instead of above this
              // button.
              <div className="relative shrink-0" ref={reasoningPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowReasoningPicker(!showReasoningPicker)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-d4-surface transition-colors"
                  title={t('agent.reasoningEffort')}
                >
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span className="capitalize text-d4-muted">{settings?.reasoningEffort || 'medium'}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>

                {showReasoningPicker && (
                  <div className="absolute bottom-full mb-1.5 left-0 w-32 bg-d4-panel border border-d4-border rounded-md shadow-2xl p-1 z-50">
                    {['off', 'low', 'medium', 'high', 'auto'].map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => {
                          updateSettings({ reasoningEffort: lvl as any });
                          setShowReasoningPicker(false);
                        }}
                        className={`w-full text-left px-2 py-1 rounded text-xs capitalize flex items-center justify-between ${
                          settings?.reasoningEffort === lvl
                            ? 'bg-d4-accent/20 text-d4-accent font-medium'
                            : 'text-d4-text hover:bg-d4-surface'
                        }`}
                      >
                        <span>{lvl}</span>
                        {settings?.reasoningEffort === lvl && <Check className="w-3 h-3" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => onOpenSettings?.('usage')}
              title={t('usage.title')}
              className="shrink-0 px-1.5 py-0.5 rounded-sm font-mono hover:bg-d4-surface transition-colors"
            >
              {formatUsd(sessionCost)} · {formatTokens(sessionTokens)} {t('usage.tokensShort')}
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={cyclePermission}
              title={t('settings.permissionMode')}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-d4-surface transition-colors"
            >
              <Shield className={`w-3 h-3 ${permission === 'full' ? 'text-d4-warning' : 'text-d4-success'}`} />
              <span className="capitalize text-d4-muted">{permission}</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenSettings?.('providers')}
              title={`${t('nav.settings')}  ·  Ctrl+,`}
              className="w-6 h-6 flex items-center justify-center rounded-sm hover:bg-d4-surface hover:text-d4-text transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
