import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Square,
  Sparkles,
  Target,
  Wand2,
  ChevronDown,
  Check,
  Search,
  Plus,
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
  Slash,
  MessageSquare
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useSettingsStore, modelKey } from '../../stores/settingsStore';
import { useQueueStore } from '../../stores/queueStore';
import { QueuedMessages } from './QueuedMessages';
import { useUsageStore } from '../../stores/usageStore';
import { toast } from '../../stores/toastStore';
import { EMPTY_MISSION, Mission, ModelInfo, ProviderConfig, PromptImage, SkillItem } from '../../../shared/types';
import { groupProviders, isProviderChoosable } from '../../../shared/provider-vendors';
import { BUILTIN_COMMANDS, expandCommandPrompt } from '../../../shared/builtin-commands';
import { isAnswerOnlyDraft } from '../../../shared/small-talk';
import { clampToGoPlan, goPlanModel, isGoProvider } from '../../../shared/opencode-go-plan';
import { useProjectStore } from '../../stores/projectStore';
import { useUiStore } from '../../stores/uiStore';
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

/**
 * The missions the composer offers, as the command ids that carry them.
 *
 * Four rows, the way a chooser should be: the three jobs people start from a
 * message (look at the code, write the commit, prepare the pull request) and
 * "Custom", which is the session mission the user writes themselves. Everything
 * else the app ships lives in the `/` menu and the skills picker.
 */
const MISSION_PRESETS = ['explain', 'commit', 'open-pr'] as const;

/** Which pill is lit; the four are one control with one answer at a time. */
type ComposerFocus = 'build' | 'plan' | 'mission' | 'skills';

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
  /**
   * Opens the provider dialog: `add` goes straight to the preset list,
   * `list` opens the keys already configured. The picker owns this entry point
   * because choosing a model is the moment a missing provider is noticed.
   */
  onOpenProviders?: (view?: 'list' | 'add') => void;
  /** `/design` opens the project style page rather than inserting a paragraph. */
  onOpenDesign?: () => void;
}> = ({ onOpenSettings, onOpenProviders, onOpenDesign }) => {
  const { t, i18n } = useTranslation();
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
  /**
   * The command chip currently attached to the message. Choosing a command
   * keeps the user's own words in the box and shows a small bold /chip above
   * them — the Freebuff look — while the full instruction travels with the
   * prompt at send time.
   */
  const [appliedCommand, setAppliedCommand] = useState<string | null>(null);
  /** The pill that is lit. One value, not four booleans that can drift apart. */
  const [focus, setFocus] = useState<ComposerFocus>('build');
  const [showMissionPicker, setShowMissionPicker] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  /**
   * The user's own skill attached to this message.
   *
   * Kept beside the command chip because they are different things: a shipped
   * command is expanded from the app, while a skill is a file in the project and
   * travels verbatim — one answer each, and never both at once.
   */
  const [appliedSkill, setAppliedSkill] = useState<SkillItem | null>(null);
  const missionPickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  /** The pill row, so pressing a pill does not count as "clicked outside". */
  const pillRowRef = useRef<HTMLDivElement>(null);
  const sessionMission = useAgentStore((state) => state.mission);

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
        setShowMissionPicker(false);
        setShowSkillPicker(false);
        // The `/` menu is dismissed by the textarea's own handler, which only
        // runs while the textarea has focus. Escape pressed anywhere else left
        // the list sitting over the message box, so dismiss it here too.
        setCommandDismissed(true);
        return;
      }
      const target = event.target as Node;
      if (!modelPickerRef.current?.contains(target)) setShowModelPicker(false);
      if (!reasoningPickerRef.current?.contains(target)) setShowReasoningPicker(false);
      if (!missionPickerRef.current?.contains(target) && !pillRowRef.current?.contains(target)) {
        setShowMissionPicker(false);
      }
      if (!skillPickerRef.current?.contains(target) && !pillRowRef.current?.contains(target)) {
        setShowSkillPicker(false);
      }
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

  /**
   * The skills picker's list, filtered by what is typed in it.
   *
   * Built-ins and the user's own skills are one list: the question this menu
   * answers is "what should run this", not "where does it live" — and picking a
   * built-in from here attaches it exactly as the mission menu does.
   */
  const skillMatches = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    return skills
      .filter(
        (skill) =>
          !q ||
          skill.id.toLowerCase().includes(q) ||
          skill.name.toLowerCase().includes(q) ||
          skill.description.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [skills, skillQuery]);

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
    if (action === 'set-mission') {
      /*
       * `/goal` writes a real mission for this session, exactly as the mission
       * panel would: the agent is sent it with every request from now on, and the
       * goal card appears above the transcript because there is something to show.
       * With no text after the command there is no goal to record, so only the
       * prompt body is placed and the mission panel is opened to collect one.
       */
      const objective = detail.trim();
      if (objective) {
        void useAgentStore.getState().setMission({
          objective,
          constraints: '',
          codingStyle: '',
          importantFiles: [],
          forbiddenActions: '',
          effort: 'medium'
        });
        toast.success(t('mission.goalSet'), objective.slice(0, 120));
      } else {
        // No text after the command: nothing to record, so open the panel that
        // does collect one instead of silently setting an empty goal.
        useUiStore.getState().showRightPanel('mission');
        toast.info(t('mission.goalNeedsText'));
      }
    }

    if (builtin) {
      // The chip carries the command; the box keeps only what the user typed.
      // The expanded instruction is rebuilt at send time, so editing the text
      // never fights a wall of boilerplate.
      setPrompt(detail);
      setAppliedCommand(builtin.id);
      if (builtin.mode) setMode(builtin.mode);
      textareaRef.current?.focus();
      return;
    }
    const body = `${skill.content}${detail ? `\n\n${detail}` : ''}`;
    setPrompt(`${body} `);
    textareaRef.current?.focus();
  };

  /**
   * Attaches a shipped command to whatever is already typed.
   *
   * The `/` menu *replaces* the box with the command's own text, because there the
   * user typed the command name. A pill is the other way round: the message is
   * written and the pill only says how to run it, so the instruction rides along
   * as a chip and is expanded at send time.
   */
  const attachCommand = (commandId: string) => {
    const builtin = BUILTIN_COMMANDS.find((entry) => entry.id === commandId);
    if (!builtin) return;
    setAppliedCommand(builtin.id);
    if (builtin.mode) setMode(builtin.mode);
    textareaRef.current?.focus();
  };

  /**
   * Attaches one skill to the message. Choosing another replaces it — a message
   * that carried two skill bodies would be two instructions fighting.
   */
  const attachSkill = (skill: SkillItem) => {
    const builtin = BUILTIN_COMMANDS.find((entry) => entry.id === skill.id);
    if (builtin) attachCommand(builtin.id);
    else setAppliedSkill(skill);
    setShowSkillPicker(false);
    setSkillQuery('');
    textareaRef.current?.focus();
  };

  /**
   * The session mission's effort, changed from the composer.
   *
   * It is a property of the mission, so the mission is what gets written; with no
   * mission yet, one is created carrying only the effort — an empty objective is
   * still "no mission" everywhere else, so nothing false is shown.
   */
  const saveMissionEffort = (effort: Mission['effort']) => {
    void useAgentStore.getState().setMission({ ...(sessionMission ?? EMPTY_MISSION), effort });
    toast.info(t('agent.missionEffortSet', { level: t(`mission.effort_${effort}`) }));
  };

  /**
   * One section per vendor, not per config.
   *
   * A vendor that answers on three protocols is three configs but one account:
   * listing it three times made the picker look like three things to set up. The
   * models of all its connections are merged here, so the list matches what the
   * user thinks they bought.
   */
  const chooserOptions = useMemo(
    () => ({ localProvidersEnabled: settings?.localProvidersEnabled }),
    [settings?.localProvidersEnabled]
  );
  const activeIds = useMemo(
    () => (settings?.activeProviderId ? [settings.activeProviderId] : []),
    [settings?.activeProviderId]
  );
  /** Whether one config may be listed at all — the rule recents and favourites share. */
  const isListable = useCallback(
    (provider?: ProviderConfig) => !!provider && isProviderChoosable(provider, activeIds, chooserOptions),
    [activeIds, chooserOptions]
  );

  const usableVendors = useMemo(
    () =>
      groupProviders(
        providers.filter((p) => isProviderChoosable(p, activeIds, chooserOptions)),
        { activeProviderIds: activeIds }
      ).map((group) => ({
        ...group,
        /*
         * A Go subscription serves a fixed list, and the endpoint it is asked can
         * name models the plan does not include — a `claude-*` id in the Go menu
         * fails at request time. The clamp here is the same one the merge uses, so
         * the menu cannot offer what the merge would refuse to store.
         */
        models: isGoProvider(group.id) ? group.models.filter((entry) => !!goPlanModel(entry.model.id)) : group.models
      })),
    [providers, activeIds, chooserOptions]
  );

  const currentProvider = providers.find((p) => p.id === settings?.activeProviderId);
  const currentModel = currentProvider?.models.find((m) => m.id === settings?.activeModelId);
  const showReasoning = isAuto || !!currentModel?.supportsReasoning;
  const canSeeImages = isAuto || !!currentModel?.supportsVision;

  const filteredVendors = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    const matches = (m: ModelInfo) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    const vendors = usableVendors
      .map((group) => ({ group, models: group.models.filter((entry) => matches(entry.model)) }))
      // With a query, a vendor with no matching model is noise; without one, a
      // vendor that answered nothing is still worth showing with its label.
      .filter((entry) => entry.models.length > 0 || (!q && entry.group.models.length > 0));
    return vendors;
  }, [usableVendors, modelQuery]);

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
    // A chip on the box means the shipped instruction goes with it — the command
    // first, then a skill's own body, and the user's words either way.
    const builtin = appliedCommand ? BUILTIN_COMMANDS.find((entry) => entry.id === appliedCommand) : undefined;
    const detail = prompt.trim();
    const outgoing = builtin
      ? expandCommandPrompt(builtin, prompt)
      : appliedSkill
        ? `Execute skill: /${appliedSkill.name}\n\n${appliedSkill.content}${detail ? `\n\n${detail}` : ''}`
        : detail;
    setAppliedCommand(null);
    setAppliedSkill(null);
    if (targetMode) setMode(targetMode);
    if (isRunning) {
      addItem(outgoing, targetMode || mode, images);
      toast.info(t('rightSidebar.queued'));
      setPrompt('');
      setImages([]);
      return;
    }
    void startAgent(outgoing, images);
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
    // Ctrl/Cmd+Enter asks for a plan whatever chip is lit; plain Enter sends in
    // the mode the user picked. Enter used to force Build, which flipped the
    // chip out from under the user: Plan was chosen, Build ran, and nothing on
    // screen said why.
    send(e.ctrlKey || e.metaKey ? 'plan' : undefined);
  };

  const renderModelRow = (providerId: string, model: ModelInfo) => {
    const key = modelKey(providerId, model.id);
    const isActive = settings?.activeProviderId === providerId && settings?.activeModelId === model.id;
    const isFavorite = favoriteKeys.includes(key);
    // Go is a subscription with a fixed list and a monthly ceiling per model, not
    // a pay-per-token gateway: the limit is the number that matters when picking
    // between them, and it is not something the `/models` endpoint reports.
    const plan = isGoProvider(providerId) ? goPlanModel(model.id) : undefined;
    const language = i18n.language === 'th' ? 'th' : 'en';
    const planTitle = plan
      ? [
          plan.monthlyLimitUsd !== undefined
            ? t('agent.goLimit', { amount: plan.monthlyLimitUsd })
            : t('agent.goNoLimit'),
          t('agent.goLimitSplit'),
          plan.note ? plan.note[language] : ''
        ]
          .filter(Boolean)
          .join('\n')
      : undefined;
    return (
      <button
        key={key}
        type="button"
        onClick={() => handleSelectModel(providerId, model.id)}
        title={planTitle}
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
          {plan?.monthlyLimitUsd !== undefined && (
            <span className="text-d4-accent/80">{t('agent.goLimitShort', { amount: plan.monthlyLimitUsd })}</span>
          )}
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
      return provider && model ? { providerId, model } : null;
    })
    .filter((x): x is { providerId: string; model: ModelInfo } => !!x);

  /*
   * Favourites and recents are shortcuts into the same menu, so they obey the
   * same rule: a favourited Ollama model used to appear under "favourites" even
   * with local runtimes switched off, which is exactly the clutter the switch is
   * meant to remove. A Go entry is clamped too, for the same reason as above.
   */
  const visibleFavorites = favoriteModels
    .filter(({ providerId }) => isListable(providers.find((p) => p.id === providerId)))
    .filter(({ providerId, model }) => !isGoProvider(providerId) || clampToGoPlan(providerId, [model]).length > 0);

  const visibleRecents = recentKeys
    .map((key) => {
      const [providerId, modelId] = key.split('::');
      const provider = providers.find((p) => p.id === providerId);
      const model = provider?.models.find((m) => m.id === modelId);
      return provider && model ? { providerId, model } : null;
    })
    .filter((x): x is { providerId: string; model: ModelInfo } => !!x)
    .filter(({ providerId }) => isListable(providers.find((p) => p.id === providerId)))
    .filter(({ providerId, model }) => !isGoProvider(providerId) || clampToGoPlan(providerId, [model]).length > 0)
    .slice(0, 3);

  const hasContent = prompt.trim().length > 0 || images.length > 0;
  const language: 'th' | 'en' = i18n.language === 'en' ? 'en' : 'th';

  /**
   * The four composer pills share one style: the lit one is the current choice.
   * They are a single control — Build · Plan · Mission · Skills, one answer at a
   * time — so nothing here is a toggle that can be left half-on.
   */
  /**
   * Is the box holding a message that asks for nothing?
   *
   * Then Build/Plan are not a choice: there is nothing to build and nothing to
   * plan, and the runtime answers such a message with no tools at all. The
   * verdict comes from the shared rule the runtime itself acts on, so the pills
   * cannot offer a mode the run will not honour. A command or skill chip is
   * excluded on purpose — it expands into an instruction before it is sent, and
   * that expansion is work.
   */
  const answerOnly = isAnswerOnlyDraft({
    text: prompt,
    hasAttachedInstruction: Boolean(appliedCommand || appliedSkill)
  });

  const pillClass = (active: boolean, tone: 'accent' | 'warning' = 'accent') =>
    `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
      active
        ? tone === 'warning'
          ? 'bg-d4-warning/25 text-d4-warning'
          : 'bg-d4-accent text-black'
        : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface'
    }`;

  const closePickers = () => {
    setShowMissionPicker(false);
    setShowSkillPicker(false);
  };

  /**
   * What the attached-command chip says.
   *
   * A mission shows its own name and the effort it runs at — Freebuff's
   * "Custom · High" — while any other shipped command (reached through the `/`
   * menu) shows its name. The chip has to name what is attached either way, or a
   * lit chip with no label is worse than no chip.
   */
  const commandChipLabel = (id: string): string =>
    (MISSION_PRESETS as readonly string[]).includes(id)
      ? `${t(`agent.missionPreset_${id}`)} · ${t(`mission.effort_${sessionMission?.effort ?? 'medium'}`)}`
      : `/${id}`;
  const sessionCost = summary?.session.cost ?? 0;
  const sessionTokens = (summary?.session.inputTokens ?? 0) + (summary?.session.outputTokens ?? 0);
  const permission = settings?.permissionMode || 'safe';

  const cyclePermission = () => {
    const order: Array<'safe' | 'ask' | 'full'> = ['safe', 'ask', 'full'];
    updateSettings({ permissionMode: order[(order.indexOf(permission) + 1) % order.length] });
  };

  return (
    <div className="relative shrink-0 bg-d4-bg px-4 pb-2 pt-1">
      {/* The box lines up with the transcript column above it, so the message and
          the field it was typed in share one axis. */}
      <div
        className="mx-auto w-full max-w-[760px]"
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
        {/*
         * Messages typed while the agent is busy wait here, one row above the
         * field they were typed in — a queued message you cannot see is a
         * message you will type twice.
         */}
        <QueuedMessages />

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
          {/* ------------------------------------------------- mission picker */}
          {/*
           * What Freebuff's Mission menu is: the few jobs worth starting from a
           * message, plus the session mission itself. Choosing one attaches the
           * shipped instruction to this message as a chip — nothing is sent until
           * the user presses send.
           */}
          {showMissionPicker && (
            <div
              ref={missionPickerRef}
              className="absolute bottom-full left-2 mb-2 z-40 w-[336px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-d4-border-subtle flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-d4-accent" />
                <span className="text-[11px] font-semibold text-d4-text">{t('agent.missionTitle')}</span>
              </div>

              <div className="p-1">
                {MISSION_PRESETS.map((id) => {
                  const command = BUILTIN_COMMANDS.find((entry) => entry.id === id);
                  const active = appliedCommand === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        attachCommand(id);
                        setShowMissionPicker(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded flex items-start justify-between gap-2 hover:bg-d4-surface transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs text-d4-text">{t(`agent.missionPreset_${id}`)}</span>
                        <span className="block text-[10px] text-d4-dimmed leading-snug">
                          {command?.summary[language] ?? ''}
                        </span>
                      </span>
                      {active && <Check className="w-3 h-3 text-d4-accent shrink-0 mt-0.5" />}
                    </button>
                  );
                })}

                {/* "Custom" is the session mission: the one that lives with the
                    session and is sent with every request until it is cleared. */}
                <button
                  type="button"
                  onClick={() => {
                    setShowMissionPicker(false);
                    useUiStore.getState().showRightPanel('mission');
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded flex items-start justify-between gap-2 hover:bg-d4-surface transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-xs text-d4-text">{t('agent.missionCustom')}</span>
                    <span className="block text-[10px] text-d4-dimmed leading-snug">
                      {t('agent.missionCustomHint')}
                    </span>
                  </span>
                  {!!sessionMission?.objective && (
                    <Check className="w-3 h-3 text-d4-accent shrink-0 mt-0.5" />
                  )}
                </button>
              </div>

              <div className="border-t border-d4-border-subtle px-2.5 py-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-d4-dimmed font-semibold">
                  {t('agent.missionEffort')}
                </div>
                <div className="flex items-center gap-1">
                  {(['low', 'medium', 'high'] as const).map((level, index) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => saveMissionEffort(level)}
                      title={t(`mission.effort_${level}`)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-1.5 py-1 rounded-sm text-[10px] border transition-colors ${
                        (sessionMission?.effort ?? 'medium') === level
                          ? 'border-d4-accent/50 bg-d4-accent/15 text-d4-accent'
                          : 'border-d4-border text-d4-dimmed hover:text-d4-text'
                      }`}
                    >
                      {/* Effort as the meter a chooser should be: more bars, more work. */}
                      <span className="flex items-end gap-[2px]" aria-hidden>
                        {[0, 1, 2].map((bar) => (
                          <span
                            key={bar}
                            className={`w-[3px] rounded-sm ${bar <= index ? 'bg-current' : 'bg-d4-border'}`}
                            style={{ height: `${4 + bar * 3}px` }}
                          />
                        ))}
                      </span>
                      {t(`mission.effort_${level}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------- skill picker */}
          {/*
           * One skill, not many: a message that carried two skill bodies would be
           * two instructions fighting over the same work. The chosen one is shown
           * as a chip on the box and sent with the request.
           */}
          {showSkillPicker && (
            <div
              ref={skillPickerRef}
              className="absolute bottom-full left-2 mb-2 z-40 w-[336px] max-h-72 bg-d4-panel border border-d4-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-2 border-b border-d4-border-subtle flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-d4-dimmed" />
                <input
                  autoFocus
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder={t('agent.searchSkills')}
                  className="flex-1 bg-transparent text-xs text-d4-text outline-none placeholder-d4-dimmed"
                />
              </div>

              <div className="overflow-y-auto p-1">
                {skillMatches.length === 0 ? (
                  <div className="px-2.5 py-3 text-[11px] text-d4-dimmed">{t('agent.noSkillMatch')}</div>
                ) : (
                  skillMatches.map((skill) => {
                    const active = appliedSkill?.id === skill.id || appliedCommand === skill.id;
                    return (
                      <button
                        key={`${skill.id}-${skill.isGlobal}`}
                        type="button"
                        onClick={() => attachSkill(skill)}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-d4-surface transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-d4-accent shrink-0">/{skill.name}</span>
                          <span className="ml-auto shrink-0 text-[9px] text-d4-dimmed">
                            {skill.isGlobal ? t('rightSidebar.skillGlobal') : t('rightSidebar.skillProject')}
                          </span>
                          {active && <Check className="w-3 h-3 text-d4-accent shrink-0" />}
                        </span>
                        <span className="block text-[10px] text-d4-dimmed leading-snug truncate">
                          {skill.description}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-t border-d4-border-subtle p-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowSkillPicker(false);
                    // The sidebar's skills tab is gone — skills live in Settings
                    // → ทักษะ now, where they can be edited rather than only run.
                    onOpenSettings?.('skills');
                  }}
                  className="w-full text-left px-2 py-1 rounded text-[10px] text-d4-dimmed hover:text-d4-text hover:bg-d4-surface transition-colors"
                >
                  {t('agent.manageSkills')}
                </button>
              </div>
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
              // keystroke from being corrected — but a chip already applied
              // means the pick was deliberate, so the menu stays closed.
              if (!appliedCommand) setCommandDismissed(false);
            }}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []);
              if (files.length > 0) {
                e.preventDefault();
                void attach(files);
              }
            }}
            placeholder={isRunning ? t('agent.queuePlaceholder') : t('agent.inputPlaceholder')}
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-1 text-[13px] leading-relaxed text-d4-text placeholder-d4-dimmed outline-none resize-none"
          />

          <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-0.5">
            <div className="flex items-center gap-1 min-w-0 flex-wrap">
              {/* Build · Plan · Mission · Skills — one pill lit at a time. */}
              <div ref={pillRowRef} className="flex items-center gap-1">
                {/*
                 * A message with no request in it gets no mode to choose: the
                 * row says what will happen instead of asking which kind of work
                 * the user wants. The pills come straight back as soon as the
                 * text turns into an order — including "สวัสดีครับ ช่วย…".
                 */}
                {answerOnly ? (
                  /*
                   * One pill where two used to be, and the explanation in its
                   * tooltip rather than beside it: a sentence in the row pushed
                   * the Mission and Skills pills out of the box on a narrow
                   * composer, and the row has to hold all three.
                   */
                  <span role="status" title={t('agent.answerOnlyHint')} className="inline-flex shrink-0">
                    <span className={`${pillClass(true)} whitespace-nowrap`}>
                      <MessageSquare className="w-3 h-3" />
                      {t('agent.answerOnly')}
                    </span>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('build');
                        setFocus('build');
                        closePickers();
                      }}
                      aria-pressed={focus === 'build'}
                      className={pillClass(focus === 'build')}
                      title={t('agent.buildModeDesc')}
                    >
                      {t('agent.buildMode')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('plan');
                        setFocus('plan');
                        closePickers();
                      }}
                      aria-pressed={focus === 'plan'}
                      className={pillClass(focus === 'plan', 'warning')}
                      title={t('agent.planModeDesc')}
                    >
                      {t('agent.planMode')}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFocus('mission');
                    setShowSkillPicker(false);
                    setShowMissionPicker((open) => !open);
                  }}
                  aria-pressed={focus === 'mission'}
                  aria-expanded={showMissionPicker}
                  className={pillClass(focus === 'mission')}
                  title={t('agent.missionPresets')}
                >
                  <Target className="w-3 h-3" />
                  {t('agent.mission')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFocus('skills');
                    setShowMissionPicker(false);
                    setShowSkillPicker((open) => !open);
                  }}
                  aria-pressed={focus === 'skills'}
                  aria-expanded={showSkillPicker}
                  className={pillClass(focus === 'skills')}
                  title={t('agent.skillsPicker')}
                >
                  <Wand2 className="w-3 h-3" />
                  {t('agent.skills')}
                </button>
              </div>

              {/*
               * What the message will run with, next to the pills that chose it —
               * Freebuff puts the same two chips here. A chip is the only place a
               * selection is visible, so it also carries the way to undo it.
               */}
              {appliedCommand && (
                <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-d4-surface border border-d4-border text-[10px] text-d4-muted">
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('mission');
                      setShowMissionPicker(true);
                    }}
                    className="font-medium"
                    title={t('agent.missionPresets')}
                  >
                    {commandChipLabel(appliedCommand)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppliedCommand(null)}
                    className="text-d4-dimmed hover:text-d4-text"
                    title={t('common.remove')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {appliedSkill && (
                <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-d4-surface border border-d4-border text-[10px] text-d4-muted">
                  <button
                    type="button"
                    onClick={() => {
                      setFocus('skills');
                      setShowSkillPicker(true);
                    }}
                    className="font-mono"
                    title={t('agent.skillsPicker')}
                  >
                    /{appliedSkill.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAppliedSkill(null)}
                    className="text-d4-dimmed hover:text-d4-text"
                    title={t('common.remove')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}

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
                title={t('agent.selectModel')}
                aria-label={t('agent.selectModel')}
                aria-expanded={showModelPicker}
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

                    {visibleFavorites.length > 0 && !modelQuery && (
                      <div className="mb-1">
                        <div className="d4-label px-2 py-1">{t('agent.favorites')}</div>
                        {visibleFavorites.map(({ providerId, model }) => renderModelRow(providerId, model))}
                      </div>
                    )}

                    {visibleRecents.length > 0 && !modelQuery && (
                      <div className="mb-1">
                        <div className="d4-label px-2 py-1">{t('agent.recent')}</div>
                        {visibleRecents.map(({ providerId, model }) => renderModelRow(providerId, model))}
                      </div>
                    )}

                    {filteredVendors.length === 0 ? (
                      <div className="text-center py-6 px-4 text-d4-dimmed text-[11px] space-y-2">
                        <div>{modelQuery.trim() ? t('agent.noModelMatch') : t('agent.noModels')}</div>
                        {onOpenProviders && !modelQuery.trim() && (
                          <button
                            onClick={() => {
                              setShowModelPicker(false);
                              onOpenProviders('add');
                            }}
                            className="text-d4-accent hover:underline"
                          >
                            {t('agent.connectProvider')}
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredVendors.map(({ group, models }) => (
                        <div key={group.id} className="mb-1">
                          <div className="d4-label px-2 py-1 flex items-center justify-between">
                            <span>{group.name}</span>
                            <span className="text-d4-dimmed normal-case font-normal">
                              {group.keyUnreadable
                                ? t('providers.keyUnreadableShort')
                                : group.hasApiKey
                                  ? t('providers.modelsCount', { count: group.models.length })
                                  : t('providers.local')}
                            </span>
                          </div>
                          {models.map(({ model, providerId }) => renderModelRow(providerId, model))}
                        </div>
                      ))
                    )}
                  </div>

                  {/* The way in to every provider, exactly where the question
                      "why is my model not here?" is asked. */}
                  <div className="border-t border-d4-border-subtle p-1.5 shrink-0">
                    {/*
                     * Local runtimes are opt-in. The switch lives here, under
                     * the list they affect, because "why is my model not in the
                     * menu?" is exactly the question that leads to it — and a
                     * user who runs Ollama should not have to find a Settings tab
                     * to say so.
                     */}
                    <button
                      type="button"
                      onClick={() => {
                        const enabling = !settings?.localProvidersEnabled;
                        void updateSettings({ localProvidersEnabled: enabling });
                        toast.info(enabling ? t('providers.localToastOn') : t('providers.localToastOff'));
                      }}
                      className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left hover:bg-d4-surface transition-colors"
                    >
                      <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-d4-dimmed" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-d4-text">{t('providers.localToggle')}</span>
                        <span className="block text-[10px] text-d4-dimmed">{t('providers.localToggleHint')}</span>
                      </span>
                      <span
                        className={`mt-0.5 shrink-0 w-7 h-4 rounded-full border transition-colors relative ${
                          settings?.localProvidersEnabled ? 'bg-d4-accent/30 border-d4-accent' : 'bg-d4-surface border-d4-border'
                        }`}
                        aria-hidden
                      >
                        <span
                          className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                            settings?.localProvidersEnabled ? 'left-3.5 bg-d4-accent' : 'left-0.5 bg-d4-dimmed'
                          }`}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowModelPicker(false);
                        onOpenProviders?.('add');
                      }}
                      className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left hover:bg-d4-surface transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 mt-0.5 shrink-0 text-d4-accent" />
                      <span className="min-w-0">
                        <span className="block text-xs text-d4-text">{t('providers.connectTitle')}</span>
                        <span className="block text-[10px] text-d4-dimmed">{t('providers.connectHint')}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowModelPicker(false);
                        onOpenProviders?.('list');
                      }}
                      className="w-full text-left px-2 py-1 pl-8 rounded text-[10px] text-d4-dimmed hover:text-d4-text hover:bg-d4-surface transition-colors"
                    >
                      {t('providers.manageKeys')}
                    </button>
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
              onClick={() => onOpenSettings?.()}
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
