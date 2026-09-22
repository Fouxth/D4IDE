import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCcw,
  ExternalLink,
  Play,
  Pause,
  Trash2,
  Plus,
  Save,
  RefreshCw,
  X,
  ChevronUp,
  ChevronDown,
  Pencil,
  Check,
  PanelRightClose,
  Lock,
  Copy,
  RotateCw
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChangesStore } from '../../stores/changesStore';
import { useQueueStore } from '../../stores/queueStore';
import { useAgentStore } from '../../stores/agentStore';
import { useProject, useProjectStore } from '../../stores/projectStore';
import { useUsageStore } from '../../stores/usageStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { Checkpoint, EMPTY_MISSION, Mission, SkillItem } from '../../../shared/types';
import { UsagePanel } from '../usage/UsagePanel';
import { GitTab } from './GitTab';
import { RulesPanel } from '../rules/RulesPanel';
import { LazyPanel } from '../../components/LazyPanel';

/**
 * The terminal owns xterm, which is a few hundred kilobytes of parser and
 * renderer that nobody needs until the terminal tab is opened. Importing it
 * statically here put it in the launch bundle through the side panel, which is
 * on screen from the first frame.
 */
const TerminalPanel = React.lazy(() =>
  import('../terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel }))
);
import { formatTokens, formatRelativeTime } from '../../lib/format';
import { devServerUrlFromCommand, startsDevServer, isLocalUrl } from '../../lib/preview-url';
import { insideFolder } from '../../../shared/project-paths';
import { PREVIEW_VIEWPORTS, fitScale, presetWidth } from '../../lib/preview-viewport';

export type RightPanelTab =
  | 'queue'
  | 'mission'
  | 'changes'
  | 'files'
  | 'context'
  | 'usage'
  | 'checkpoints'
  | 'preview'
  | 'terminal'
  | 'git'
  | 'skills'
  | 'rules';

type TabId = RightPanelTab;

interface RightSidebarProps {
  width?: number;
  onClose?: () => void;
  onOpenSettings?: (tab?: string) => void;
  /** Controlled from the shell so the command palette can reveal a panel. */
  activeTab?: TabId;
  onTabChange?: (tab: TabId) => void;
}

interface CheckpointSummary extends Checkpoint {
  fileCount: number;
}

/** How many skill chips fit before the rest fold behind a counter. */
const SKILL_CHIPS_VISIBLE = 7;

export const RightSidebar: React.FC<RightSidebarProps> = ({
  width = 380,
  onClose,
  onOpenSettings,
  activeTab: controlledTab,
  onTabChange
}) => {
  const { t } = useTranslation();
  const [localTab, setLocalTab] = useState<TabId>('queue');
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = (tab: TabId) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };
  const { changes, activeDiffFile, setActiveDiff, revertChange, clearChanges } = useChangesStore();
  const {
    items: queueItems,
    removeItem,
    runNext,
    addItem,
    moveItem,
    updateItem,
    pauseAll,
    resumeAll,
    markDone,
    retryItem,
    runItem,
    autoRun,
    clearFinished
  } = useQueueStore();
  const { startAgent, timeline, mode, sessionId } = useAgentStore();
  // `openFiles` is deliberately *not* subscribed to: it is read once, inside the
  // checkpoint-restore handler, and its identity changes on every keystroke.
  // Subscribing to it re-rendered this entire panel (queue, changes, git, usage,
  // mission…) while the user typed in the editor.
  const { projectPath, fileTree, reloadFileFromDisk } = useProject((s) => ({
    projectPath: s.projectPath,
    fileTree: s.fileTree,
    reloadFileFromDisk: s.reloadFileFromDisk
  }));
  const { summary, load: loadUsage } = useUsageStore();
  const { settings, providers } = useSettingsStore();

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillItem | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  /**
   * The address the frame is showing — `''` until something real is found.
   *
   * It used to start as `http://localhost:5173`, which is the address *one*
   * kind of project uses. Every other project opened the panel on a dead port
   * and looked broken, and a project serving on 4000 was never tried at all.
   * The address now only ever comes from the project itself: the port its own
   * script declares, the address its server printed, or the port a running dev
   * process is listening on (see `detectPreview`).
   */
  const [previewUrl, setPreviewUrl] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  /**
   * The frame's width preset.
   *
   * A layout that only works at 1440px is not a layout that works, and resizing
   * the whole window to check is the slowest way to find that out.
   */
  const [previewViewport, setPreviewViewport] = useState<'responsive' | 'desktop' | 'tablet' | 'mobile'>(
    'responsive'
  );
  /**
   * The frame's measured box. A fixed viewport lays the app out at the device's
   * real width (834px tablet, 390px phone — see `presetWidth`) and then scales
   * that stage to fit this box, so the numbers need to be known to compute the
   * scale. Measured, not assumed: the panel is user-resizable.
   */
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  /**
   * Whether anything is actually answering on `previewUrl`. An iframe pointed at
   * a dead port renders a blank white rectangle with no explanation, which is
   * exactly what "the preview does not work" looks like — so the panel probes
   * the URL and says what it found.
   */
  const [previewState, setPreviewState] = useState<'idle' | 'checking' | 'ready' | 'offline'>('idle');
  const lastAutoOpened = useRef<string | null>(null);
  /** Uncommitted work, surfaced on the git tab without having to open it. */
  const [gitDirty, setGitDirty] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [queueInput, setQueueInput] = useState('');
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const [queueOpen, setQueueOpen] = useState(true);
  const [mission, setMission] = useState<Mission>({ ...EMPTY_MISSION });
  const [missionSaved, setMissionSaved] = useState(true);

  /**
   * The mission belongs to the current session, so it is loaded per session id.
   *
   * It is mirrored into the agent store as well: the goal card above the
   * transcript shows only when a mission exists, and two components reading two
   * copies of one value is how a card and a switch start disagreeing.
   */
  useEffect(() => {
    if (!window.electronAPI || !sessionId) {
      setMission({ ...EMPTY_MISSION });
      useAgentStore.setState({ mission: null });
      return;
    }
    void window.electronAPI
      .getMission(sessionId)
      .then((stored: Mission | null) => {
        const merged = stored ? { ...EMPTY_MISSION, ...stored } : { ...EMPTY_MISSION };
        setMission(merged);
        useAgentStore.setState({ mission: merged.objective?.trim() ? merged : null });
      })
      .catch(() => {
        setMission({ ...EMPTY_MISSION });
        useAgentStore.setState({ mission: null });
      });
  }, [sessionId]);

  const patchMission = (patch: Partial<Mission>) => {
    setMission((prev) => ({ ...prev, ...patch }));
    setMissionSaved(false);
  };

  const saveMission = async () => {
    if (!window.electronAPI || !sessionId) {
      toast.info(t('mission.needSession'));
      return;
    }
    const stored = await window.electronAPI.setMission(sessionId, mission);
    const merged = stored ? { ...EMPTY_MISSION, ...stored } : { ...EMPTY_MISSION };
    setMission(merged);
    useAgentStore.setState({ mission: merged.objective?.trim() ? merged : null });
    setMissionSaved(true);
    toast.success(stored ? t('mission.saved') : t('mission.cleared'));
  };

  const toggleMission = async () => {
    // The switch binds the mission to this session or releases it. Releasing
    // clears the stored mission, which is what "off" has to mean — a suspended
    // mission that still gets sent would be a lie.
    if (missionSaved && mission.objective) {
      setMission({ ...EMPTY_MISSION });
      useAgentStore.setState({ mission: null });
      if (window.electronAPI && sessionId) await window.electronAPI.setMission(sessionId, { ...EMPTY_MISSION });
      toast.info(t('mission.cleared'));
      return;
    }
    if (!mission.objective) {
      setActiveTab('mission');
      return;
    }
    await saveMission();
  };

  const refreshSkills = () => {
    if (window.electronAPI) window.electronAPI.listSkills(projectPath || undefined).then(setSkills).catch(console.error);
  };

  const refreshCheckpoints = () => {
    if (!window.electronAPI) return;
    window.electronAPI
      .listCheckpoints()
      .then((list: Checkpoint[]) => setCheckpoints(list.map((c) => ({ ...c, fileCount: c.files?.length ?? 0 }))))
      .catch(console.error);
  };

  /**
   * Looks for a local server to show.
   *
   * `notify` is only true when the user asked by pressing the button. Switching
   * to the preview tab runs this too, and toasting "no dev server" every single
   * time stacked five identical notices over a panel that already says exactly
   * that, with the two buttons that fix it.
   */
  const detectPreview = async (notify = false) => {
    if (!window.electronAPI) return;
    // No folder, no preview: every address on the machine belongs to somebody,
    // and without a project there is nothing to tell whose it is.
    if (!projectPath) {
      setDetectedUrls([]);
      setPreviewUrl('');
      setPreviewState('idle');
      if (notify) toast.info(t('rightSidebar.launchNeedsProject'));
      return;
    }
    setIsDetecting(true);
    try {
      // The main process orders these: servers that printed their address and
      // answer come first, then ports the project declares, then ports a dev
      // process is listening on, then anything still booting. A port that
      // answers nothing is not in the list at all.
      const urls = await window.electronAPI.detectPreviewUrls(projectPath || undefined);
      setDetectedUrls(urls);
      // Follow the project: when the address on screen is gone (the server was
      // restarted on another port) or nothing has been picked yet, take the
      // best answer. A live address the user chose by hand is left alone.
      if (urls.length > 0 && (!previewUrl || !urls.includes(previewUrl))) {
        if (!previewUrl || !(await answers(previewUrl))) setPreviewUrl(urls[0]);
      }
      if (notify) {
        if (urls.length === 0) toast.info(t('rightSidebar.noDevServer'));
        else toast.success(t('rightSidebar.foundDevServer'), urls[0]);
      }
    } finally {
      setIsDetecting(false);
    }
  };

  /**
   * Starts the project's dev server from the panel.
   *
   * Without this the panel could only ever explain that nothing was running —
   * and the user's next question ("so start it") had no answer here. The command
   * is the one the project declares in `package.json`; the address arrives
   * through the discovered-url event once the server prints it.
   */
  const launchPreview = async () => {
    if (!window.electronAPI?.launchPreview) return;
    if (!projectPath) {
      toast.info(t('rightSidebar.launchNeedsProject'));
      return;
    }
    setIsLaunching(true);
    try {
      const result = await window.electronAPI.launchPreview(projectPath);
      // The project was already serving: point at the running server instead
      // of starting a twin that would fight it for the port.
      if (result?.alreadyRunning) {
        const url = String(result.url || '');
        if (url) {
          setPreviewUrl(url);
          setDetectedUrls((prev) => (prev.includes(url) ? prev : [url, ...prev]));
          setPreviewState('checking');
        }
        toast.info(t('rightSidebar.alreadyRunning'), url || undefined);
        return;
      }
      if (!result?.started) {
        // A declared port another project holds is refused by the main process,
        // not raced — say which port, or the error reads as a generic failure.
        if (result?.error === 'port-busy' && result?.port) {
          toast.error(t('rightSidebar.portBusy', { port: String(result.port) }));
          return;
        }
        toast.error(t('rightSidebar.launchFailed'), String(result?.error || ''));
        return;
      }
      // The port was decided before the server started, so the panel can point
      // at it right away — and if the server ends up somewhere else, its own
      // banner is what corrects the address a moment later.
      toast.success(t('rightSidebar.launchStarted'), String(result.url || result.command));
      if (typeof result.url === 'string' && result.url) setPreviewUrl(result.url);
      setPreviewState('checking');
      // The server needs a moment to bind its port; probing now would only
      // report "offline" on a perfectly healthy start.
      setTimeout(() => void detectPreview(false), 2500);
    } finally {
      setIsLaunching(false);
    }
  };

  useEffect(() => {
    refreshSkills();
  }, [projectPath]);

  useEffect(() => {
    if (activeTab === 'checkpoints') refreshCheckpoints();
    if (activeTab === 'usage') loadUsage();
    if (activeTab === 'preview') void detectPreview(false);
  }, [activeTab]);

  /**
   * The preview is the *open project's* preview, so switching projects has to
   * take the old address with it.
   *
   * Leaving it on screen was how a neighbouring project's app ended up inside
   * this panel: the address outlived the project it belonged to, and the frame
   * kept rendering something that had nothing to do with the folder on screen.
   */
  useEffect(() => {
    setPreviewUrl('');
    setDetectedUrls([]);
    setPreviewState('idle');
    lastAutoOpened.current = null;
    if (activeTab === 'preview') void detectPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  /** True when something is answering on the address. */
  const answers = async (url: string): Promise<boolean> => {
    if (!url) return false;
    try {
      await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Probes the preview URL so the panel can explain an empty frame — and, when
   * the address in the box is dead but another candidate answers, moves to that
   * one instead of leaving the user staring at an offline notice for a server
   * that is running perfectly well on a different port.
   */
  const probePreview = async (url = previewUrl) => {
    if (!url) {
      // Nothing to show yet. The panel says so, with the button that finds or
      // starts the project's own server, instead of pointing at a dead port.
      setPreviewState(detectedUrls.length > 0 ? 'idle' : 'offline');
      return;
    }
    setPreviewState('checking');
    if (await answers(url)) {
      setPreviewState('ready');
      return;
    }

    for (const candidate of detectedUrls) {
      if (candidate === url) continue;
      if (await answers(candidate)) {
        setPreviewUrl(candidate);
        setPreviewState('ready');
        toast.info(t('rightSidebar.previewMoved', { url: candidate }));
        return;
      }
    }
    setPreviewState('offline');
  };

  useEffect(() => {
    if (activeTab !== 'preview') return;
    void probePreview(previewUrl);
    // Re-probe on a timer: a dev server that is still booting answers a few
    // seconds later, and the panel should show it without a manual refresh.
    const timer = setInterval(() => void probePreview(previewUrl), 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, previewUrl]);

  /** Keeps the frame's measured box current while the panel is resized. */
  useEffect(() => {
    if (!frameEl) return;
    const measure = () => setFrameSize({ width: frameEl.clientWidth, height: frameEl.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frameEl);
    return () => observer.disconnect();
  }, [frameEl]);

  /**
   * A fixed preset renders a stage at the device's real width, scaled by `fit`
   * into the panel; `responsive` simply fills it. The first paint before the
   * observer reports falls back to filling, so a wrong-looking guess never
   * lingers longer than one frame.
   */
  const presetWidthPx = presetWidth(previewViewport);
  const fit = presetWidthPx && frameSize.width > 0 ? fitScale(presetWidthPx, frameSize.width) : 1;

  /**
   * The most recent thing the agent did that implies a local web server: either
   * a command that starts one, or the browser tool visiting a local address.
   */
  /** There is an address — or a candidate for one — for the frame to show. */
  const hasPreviewTarget = !!previewUrl || detectedUrls.length > 0;

  const previewSignal = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const item = timeline[i];
      const args = item.toolCall?.args as Record<string, unknown> | undefined;
      if (!args) continue;
      const command = typeof args.command === 'string' ? args.command : '';
      if (command && startsDevServer(command)) {
        return { id: item.id, url: devServerUrlFromCommand(command) };
      }
      const url = typeof args.url === 'string' ? args.url : '';
      if (url && isLocalUrl(url)) return { id: item.id, url };
    }
    return null;
  }, [timeline]);

  /**
   * Opens the preview by itself when the agent starts a dev server. Waiting for
   * the user to find the tab meant the server ran with nobody looking at it —
   * the panel is only useful if it appears when there is something to see.
   */
  useEffect(() => {
    if (!previewSignal || previewSignal.id === lastAutoOpened.current) return;
    lastAutoOpened.current = previewSignal.id;      if (previewSignal.url) setPreviewUrl(previewSignal.url);
    else void detectPreview(false);
    setActiveTab('preview');
    toast.info(t('rightSidebar.previewOpened'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSignal]);

  /**
   * The address a server actually bound to, straight from its own output.
   *
   * Reading it from the command is a guess; the server prints the truth, and it
   * is the only thing that works when a project serves on a port of its own
   * choosing. Arriving here means the panel opens on the right address even
   * while the server is still booting.
   */
  useEffect(() => {
    const subscribe = window.electronAPI?.onPreviewDiscovered;
    if (typeof subscribe !== 'function') return;
    return subscribe((payload: { url?: string; folder?: string | null } | null) => {
      const url = payload?.url;
      if (!url || url === lastAutoOpened.current) return;
      // A server that belongs to another project is not this panel's news —
      // opening the preview on it is how the neighbouring app ended up here.
      if (!insideFolder(payload?.folder || undefined, projectPath)) return;
      lastAutoOpened.current = url;
      setPreviewUrl(url);
      setDetectedUrls((prev) => (prev.includes(url) ? prev : [url, ...prev]));
      setActiveTab('preview');
      void probePreview(url);
      toast.info(t('rightSidebar.previewOpened'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-probes the moment the agent touches a port, so a fresh server shows up. */
  useEffect(() => {
    if (activeTab === 'preview' && previewSignal) void probePreview(previewSignal.url || previewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSignal]);

  // Files the agent actually opened or touched this session.
  const referencedFiles = useMemo(
    () =>
      Array.from(
        new Set(
          timeline
            .filter((item) => item.toolCall && (item.toolCall.args?.path || item.toolCall.args?.filePath))
            .map((item) => (item.toolCall?.args?.path || item.toolCall?.args?.filePath) as string)
        )
      ),
    [timeline]
  );

  // Token estimate from the content the agent actually exchanged this session
  // (~4 characters per token, the same heuristic the context engine uses).
  const contextBreakdown = useMemo(() => {
    const fileTokens = timeline
      .filter((item) => item.type === 'tool_result' && item.toolResult?.success)
      .reduce((sum, item) => sum + Math.ceil((item.content?.length || 0) / 4), 0);
    const conversationTokens = timeline.reduce((sum, item) => sum + Math.ceil((item.content?.length || 0) / 4), 0);
    return { fileTokens, conversationTokens };
  }, [timeline]);

  const activeModelContext = useMemo(() => {
    if (!settings || settings.activeProviderId === 'auto') return undefined;
    const provider = providers.find((p) => p.id === settings.activeProviderId);
    return provider?.models.find((m) => m.id === settings.activeModelId)?.contextWindow;
  }, [settings, providers]);

  /**
   * The tab row is written out in words, the way a workspace panel should be:
   * an icon alone cannot tell "changes" from "checkpoints" at a glance.
   */
  const tabs: { id: TabId; label: string; count?: number; dot?: boolean }[] = [
    { id: 'queue', label: t('rightSidebar.queue'), count: queueItems.length },
    { id: 'changes', label: t('rightSidebar.changes'), count: changes.length },
    { id: 'files', label: t('rightSidebar.files'), count: referencedFiles.length },
    { id: 'preview', label: t('rightSidebar.preview'), dot: detectedUrls.length > 0 },
    { id: 'terminal', label: t('rightSidebar.terminal') },
    { id: 'mission', label: t('rightSidebar.mission'), count: mission.objective ? 1 : 0 },
    { id: 'context', label: t('rightSidebar.context') },
    { id: 'usage', label: t('rightSidebar.usage') },
    { id: 'checkpoints', label: t('rightSidebar.checkpoints') },
    { id: 'git', label: t('rightSidebar.git'), dot: gitDirty },
    { id: 'rules', label: t('rules.title') }
  ];

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.gitStatus || !projectPath) {
      setGitDirty(false);
      return;
    }
    let cancelled = false;
    void api
      .gitStatus(projectPath)
      .then((status) => {
        if (!cancelled) setGitDirty(!!status && status.isClean === false);
      })
      .catch(() => {
        if (!cancelled) setGitDirty(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeTab]);

  const missionEnabled = !!mission.objective;
  const visibleSkills = skillsExpanded ? skills : skills.slice(0, SKILL_CHIPS_VISIBLE);
  const hiddenSkills = Math.max(0, skills.length - SKILL_CHIPS_VISIBLE);

  const runSkill = (skill: SkillItem) => startAgent(`Execute skill: /${skill.name}\n\n${skill.content}`);

  const skillChip = (skill: SkillItem) => (
    <button
      key={`${skill.id}-${skill.isGlobal}`}
      onClick={() => runSkill(skill)}
      title={skill.description || `/${skill.name}`}
      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-d4-surface border border-d4-border text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-accent/50 transition-colors max-w-[150px]"
    >
      <span className="truncate">{skill.name}</span>
    </button>
  );

  return (
    <div
      className="bg-d4-panel border-l border-d4-border-subtle flex flex-col h-full select-none text-xs shrink-0"
      style={{ width }}
    >
      {/* ------------------------------------------------------------ tabs */}
      {/*
       * These tabs wrap instead of scrolling sideways. There are ten of them and
       * the panel is ~360px wide, so a single non-wrapping row pushed half of them
       * (and the close button) past the right edge of the window, where they could
       * not be seen or clicked at all — measured live: the row's content was 604px
       * inside a 359px box, with `overflow-x-auto` giving no visible affordance.
       * Wrapping costs one extra line at narrow widths and keeps every tab
       * reachable at any window size.
       */}
      <div className="relative shrink-0 border-b border-d4-border-subtle">
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 pr-8">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-md whitespace-nowrap text-[11px] transition-colors ${
                  isActive
                    ? 'bg-d4-surface text-d4-text font-medium'
                    : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface/50'
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="text-[10px] text-d4-dimmed font-mono">{tab.count}</span>
                )}
                {tab.dot && <span className="w-1.5 h-1.5 rounded-full bg-d4-error" />}
              </button>
            );
          })}
        </div>

        {onClose && (
          <button
            onClick={onClose}
            title={t('common.close')}
            className="d4-icon-button w-6 h-6 absolute top-1 right-1"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* ----------------------------------------------------- mission bar */}
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-d4-border-subtle">
        <button
          onClick={() => void toggleMission()}
          title={missionEnabled ? t('mission.release') : t('mission.attach')}
          className={`relative w-7 h-4 rounded-full transition-colors shrink-0 ${
            missionEnabled ? 'bg-d4-accent' : 'bg-d4-subtle'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
              missionEnabled ? 'left-3.5' : 'left-0.5'
            }`}
          />
        </button>

        {/* The bar used to repeat two controls that already exist one line
            above and one tab over: a "mission" pill that did no more than the
            tab strip, and a cycling effort chip whose chevron promised a menu
            it never opened. The effort itself is chosen where the rest of the
            mission is edited — three labelled buttons, not a number. */}
        <span className="flex-1 min-w-0 truncate text-[11px] text-d4-dimmed">
          {mission.objective || t('mission.none')}
        </span>
      </div>

      <div className={`flex-1 min-h-0 ${activeTab === 'preview' || activeTab === 'terminal' ? 'flex flex-col' : 'overflow-y-auto p-3'}`}>
        {/* ---------------------------------------------------------- QUEUE */}
        {activeTab === 'queue' && (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="d4-label">{t('rightSidebar.skills')}</span>
                {/* One button, not two. The pencil next to this one was titled
                    "manage skills" but did the same job as the plus — it opened
                    a blank editor — and the skills tab behind the plus already
                    has its own add. Two doors to one room is just clutter. */}
                <button
                  onClick={() => setActiveTab('skills')}
                  title={t('rightSidebar.addSkill')}
                  className="text-d4-dimmed hover:text-d4-text"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {skills.length === 0 ? (
                <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('rightSidebar.noSkills')}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {visibleSkills.map(skillChip)}
                  {hiddenSkills > 0 && (
                    <button
                      onClick={() => setSkillsExpanded((open) => !open)}
                      className="px-2 py-0.5 rounded-full bg-d4-surface border border-d4-border text-[11px] text-d4-dimmed hover:text-d4-text transition-colors"
                    >
                      {skillsExpanded ? <ChevronUp className="w-3 h-3" /> : `${hiddenSkills} ⌄`}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <button
                  onClick={() => setQueueOpen((open) => !open)}
                  className="flex items-center gap-1 d4-label hover:text-d4-muted"
                >
                  <span>{t('rightSidebar.queue')}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${queueOpen ? '' : '-rotate-90'}`} />
                </button>
                <div className="flex items-center gap-1.5 normal-case text-[10px]">
                  {queueItems.length > 0 && (
                    <button onClick={runNext} className="flex items-center gap-1 text-d4-accent hover:underline">
                      <Play className="w-3 h-3" />
                      <span>{t('rightSidebar.runNext')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => (autoRun ? pauseAll() : resumeAll())}
                    title={autoRun ? t('rightSidebar.pauseQueue') : t('rightSidebar.resumeQueue')}
                    className={`p-0.5 ${autoRun ? 'text-d4-dimmed hover:text-d4-text' : 'text-d4-warning'}`}
                  >
                    {autoRun ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={clearFinished}
                    title={t('rightSidebar.clearFinished')}
                    className="p-0.5 text-d4-dimmed hover:text-d4-text"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {queueOpen && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-1.5">
                    <input
                      value={queueInput}
                      onChange={(e) => setQueueInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && queueInput.trim()) {
                          addItem(queueInput.trim(), mode);
                          setQueueInput('');
                        }
                      }}
                      placeholder={t('rightSidebar.queuePlaceholder')}
                      className="flex-1 bg-d4-surface border border-d4-border rounded-md px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent"
                    />
                    <button
                      onClick={() => {
                        if (queueInput.trim()) {
                          addItem(queueInput.trim(), mode);
                          setQueueInput('');
                        }
                      }}
                      className="p-1.5 bg-d4-surface border border-d4-border rounded-md text-d4-muted hover:text-d4-text"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {!autoRun && (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-d4-warning/10 border border-d4-warning/30 text-[10px] text-d4-warning">
                      <Pause className="w-3 h-3" />
                      <span>{t('rightSidebar.queuePaused')}</span>
                    </div>
                  )}

                  {queueItems.length === 0 ? (
                    <p className="text-[11px] text-d4-dimmed">{t('rightSidebar.emptyQueue')}</p>
                  ) : (
                    <div className="space-y-2">
                      {queueItems.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`bg-d4-surface border rounded-md p-2.5 space-y-1.5 ${
                            item.status === 'running' ? 'border-d4-accent/60' : 'border-d4-border'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-d4-dimmed">#{idx + 1}</span>
                            <div className="flex items-center space-x-1">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-d4-panel border border-d4-border uppercase text-d4-accent font-medium">
                                {item.mode}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                  item.status === 'running'
                                    ? 'border-d4-accent/40 text-d4-accent'
                                    : item.status === 'failed'
                                      ? 'border-d4-error/40 text-d4-error'
                                      : 'border-d4-border text-d4-dimmed'
                                }`}
                              >
                                {t(`rightSidebar.status_${item.status}`, { defaultValue: item.status })}
                              </span>
                            </div>
                          </div>

                          {editingQueueId === item.id ? (
                            <div className="space-y-1.5">
                              <textarea
                                value={editingQueueText}
                                onChange={(e) => setEditingQueueText(e.target.value)}
                                rows={3}
                                className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent resize-none"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setEditingQueueId(null)}
                                  className="px-2 py-0.5 text-[10px] text-d4-dimmed hover:text-d4-text"
                                >
                                  {t('common.cancel')}
                                </button>
                                <button
                                  onClick={() => {
                                    if (editingQueueText.trim()) updateItem(item.id, { prompt: editingQueueText.trim() });
                                    setEditingQueueId(null);
                                  }}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-d4-accent text-black text-[10px] font-medium"
                                >
                                  <Check className="w-3 h-3" />
                                  {t('common.save')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-d4-text text-xs leading-snug whitespace-pre-wrap line-clamp-3">
                              {item.prompt}
                            </p>
                          )}

                          {item.error && <p className="text-[10px] text-d4-error line-clamp-2">{item.error}</p>}

                          <div className="flex items-center justify-between pt-1 border-t border-d4-border-subtle">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => moveItem(item.id, -1)}
                                disabled={idx === 0}
                                title={t('rightSidebar.moveUp')}
                                className="p-0.5 text-d4-dimmed hover:text-d4-text disabled:opacity-30"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => moveItem(item.id, 1)}
                                disabled={idx === queueItems.length - 1}
                                title={t('rightSidebar.moveDown')}
                                className="p-0.5 text-d4-dimmed hover:text-d4-text disabled:opacity-30"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingQueueId(item.id);
                                  setEditingQueueText(item.prompt);
                                }}
                                title={t('common.edit')}
                                className="p-0.5 text-d4-dimmed hover:text-d4-text"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5 text-[10px]">
                              {(item.status === 'failed' || item.status === 'cancelled') && (
                                <button
                                  onClick={() => retryItem(item.id)}
                                  className="flex items-center gap-1 text-d4-warning hover:underline"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  {t('rightSidebar.retry')}
                                </button>
                              )}
                              {item.status === 'queued' && (
                                <button onClick={() => runItem(item.id)} className="text-d4-accent hover:underline">
                                  {t('rightSidebar.runNow')}
                                </button>
                              )}
                              {item.status === 'running' ? (
                                <button onClick={() => markDone(item.id)} className="text-d4-success hover:underline">
                                  {t('rightSidebar.markDone')}
                                </button>
                              ) : (
                                <button
                                  onClick={() => markDone(item.id)}
                                  className="text-d4-dimmed hover:text-d4-success"
                                  title={t('rightSidebar.markDone')}
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              )}
                              <button onClick={() => removeItem(item.id)} className="p-0.5 text-d4-dimmed hover:text-d4-error">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- MISSION */}
        {activeTab === 'mission' && (
          <div className="space-y-3">
            <div>
              <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('rightSidebar.mission')}</div>
              <p className="text-[10px] text-d4-dimmed mt-0.5">{t('mission.hint')}</p>
            </div>

            <label className="block space-y-1">
              <span className="d4-label">{t('mission.objective')}</span>
              <textarea
                value={mission.objective}
                onChange={(e) => patchMission({ objective: e.target.value })}
                rows={2}
                placeholder={t('mission.objectivePlaceholder')}
                className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent resize-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="d4-label">{t('mission.constraints')}</span>
              <textarea
                value={mission.constraints}
                onChange={(e) => patchMission({ constraints: e.target.value })}
                rows={3}
                placeholder={t('mission.constraintsPlaceholder')}
                className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent resize-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="d4-label">{t('mission.codingStyle')}</span>
              <input
                value={mission.codingStyle}
                onChange={(e) => patchMission({ codingStyle: e.target.value })}
                className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent"
              />
            </label>

            <label className="block space-y-1">
              <span className="d4-label">{t('mission.importantFiles')}</span>
              <input
                value={mission.importantFiles.join(', ')}
                onChange={(e) =>
                  patchMission({
                    importantFiles: e.target.value
                      .split(',')
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  })
                }
                placeholder="src/auth.ts, src/api/client.ts"
                className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-[11px] font-mono text-d4-text outline-none focus:border-d4-accent"
              />
            </label>

            <label className="block space-y-1">
              <span className="d4-label">{t('mission.forbidden')}</span>
              <textarea
                value={mission.forbiddenActions}
                onChange={(e) => patchMission({ forbiddenActions: e.target.value })}
                rows={2}
                placeholder={t('mission.forbiddenPlaceholder')}
                className="w-full bg-d4-surface border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none focus:border-d4-accent resize-none"
              />
            </label>

            <div className="space-y-1">
              <span className="d4-label">{t('mission.effort')}</span>
              <div className="flex items-center gap-1">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => patchMission({ effort: level })}
                    className={`flex-1 px-2 py-1 rounded-sm text-[10px] capitalize border ${
                      mission.effort === level
                        ? 'bg-d4-accent/20 border-d4-accent/40 text-d4-accent'
                        : 'border-d4-border text-d4-dimmed hover:text-d4-text'
                    }`}
                  >
                    {t(`mission.effort_${level}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className={`text-[10px] ${missionSaved ? 'text-d4-dimmed' : 'text-d4-warning'}`}>
                {missionSaved ? t('mission.savedState') : t('mission.unsaved')}
              </span>
              <button
                onClick={() => void saveMission()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-d4-accent text-black text-[11px] font-semibold"
              >
                <Save className="w-3 h-3" />
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- CHANGES */}
        {activeTab === 'changes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
              <span>
                {changes.length} {t('rightSidebar.changes')}
              </span>
              {changes.length > 0 && (
                <button onClick={clearChanges} className="text-d4-dimmed hover:text-d4-text text-[10px] normal-case">
                  {t('rightSidebar.clearList')}
                </button>
              )}
            </div>

            {changes.length === 0 ? (
              <p className="text-[11px] text-d4-dimmed py-2">{t('rightSidebar.emptyChanges')}</p>
            ) : (
              <div className="space-y-2">
                {changes.map((change) => (
                  <div
                    key={change.path}
                    className={`bg-d4-surface border rounded p-2.5 transition-colors cursor-pointer ${
                      activeDiffFile?.path === change.path ? 'border-d4-accent' : 'border-d4-border hover:border-d4-muted'
                    }`}
                    onClick={() => setActiveDiff(change)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-d4-text font-medium truncate max-w-[180px]">
                        {change.relativePath}
                      </span>
                      <span className="text-[10px] font-mono">
                        <span className="text-emerald-400">+{change.additions}</span>{' '}
                        <span className="text-red-400">-{change.deletions}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-d4-dimmed pt-1 border-t border-d4-border/40">
                      <span className="capitalize">{change.type}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          revertChange(change);
                        }}
                        className="flex items-center space-x-1 text-red-400/80 hover:text-red-400"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t('rightSidebar.revert')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------- FILES */}
        {activeTab === 'files' && (
          <div className="space-y-3">
            <div className="text-d4-dimmed text-[11px] uppercase font-semibold">
              {t('rightSidebar.files')} ({referencedFiles.length})
            </div>
            {referencedFiles.length === 0 ? (
              <p className="text-[11px] text-d4-dimmed py-2">{t('rightSidebar.noFiles')}</p>
            ) : (
              <div className="space-y-1">
                {referencedFiles.map((file) => (
                  <div
                    key={file}
                    className="p-2 bg-d4-surface border border-d4-border rounded font-mono text-[11px] text-d4-text truncate"
                  >
                    {file}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- CONTEXT */}
        {activeTab === 'context' && (
          <div className="space-y-3">
            <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('rightSidebar.context')}</div>
            <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-d4-muted">{t('rightSidebar.estimatedContext')}</span>
                <span className="text-d4-accent font-mono font-medium">
                  ~{formatTokens(contextBreakdown.conversationTokens)}
                  {activeModelContext ? ` / ${formatTokens(activeModelContext)}` : ''}
                </span>
              </div>
              <div className="w-full bg-d4-subtle h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-d4-accent h-full"
                  style={{
                    width: `${
                      activeModelContext
                        ? Math.min((contextBreakdown.conversationTokens / activeModelContext) * 100, 100)
                        : 10
                    }%`
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-d4-muted">
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>{t('rightSidebar.contextToolResults')}</span>
                <span className="font-mono text-d4-dimmed">~{formatTokens(contextBreakdown.fileTokens)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>{t('rightSidebar.contextConversation')}</span>
                <span className="font-mono text-d4-dimmed">~{formatTokens(contextBreakdown.conversationTokens)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>{t('rightSidebar.contextProjectFiles')}</span>
                <span className="font-mono text-d4-dimmed">{fileTree?.children?.length ?? 0}</span>
              </div>
            </div>
            <p className="text-[10px] text-d4-dimmed leading-relaxed">{t('rightSidebar.contextNote')}</p>
          </div>
        )}

        {/* ---------------------------------------------------------- USAGE */}
        {activeTab === 'usage' && <UsagePanel />}

        {/* ---------------------------------------------------- CHECKPOINTS */}
        {activeTab === 'checkpoints' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
              <span>{t('rightSidebar.checkpoints')}</span>
              <button onClick={refreshCheckpoints} className="text-d4-dimmed hover:text-d4-text" title={t('usage.refresh')}>
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {checkpoints.length === 0 ? (
              <p className="text-[11px] text-d4-dimmed py-2">{t('rightSidebar.noCheckpoints')}</p>
            ) : (
              <div className="space-y-2">
                {checkpoints.map((cp) => (
                  <div key={cp.id} className="bg-d4-surface border border-d4-border rounded p-2.5 space-y-1.5">
                    <div className="text-[11px] text-d4-text leading-snug line-clamp-2">{cp.description}</div>
                    <div className="flex items-center justify-between text-[10px] text-d4-dimmed">
                      <span>{formatRelativeTime(cp.timestamp)}</span>
                      <span className="font-mono">{cp.fileCount} files</span>
                    </div>
                    <div className="flex items-center space-x-2 pt-1 border-t border-d4-border/40">
                      <button
                        disabled={cp.fileCount === 0}
                        onClick={async () => {
                          if (!window.electronAPI) return;
                          const res = await window.electronAPI.restoreCheckpoint(cp.id, projectPath ?? undefined);
                          if (res.success) {
                            toast.success(t('rightSidebar.restored', { count: res.restored ?? 0 }));
                            // Anything skipped is a file the user expects back — say so.
                            if (res.refused?.length) {
                              toast.warning(
                                t('rightSidebar.restorePartial'),
                                t('rightSidebar.restoreSkipped', { count: res.refused.length })
                              );
                            }
                            // Re-read from disk so the editor shows what was restored.
                            // Only touched files are reopened; re-reading everything
                            // would discard unrelated unsaved edits.
                            const restoredPaths = new Set((cp.files ?? []).map((f) => f.path));
                            for (const open of useProjectStore.getState().openFiles) {
                              if (restoredPaths.has(open.path)) await reloadFileFromDisk(open.path);
                            }
                          } else {
                            toast.error(t('rightSidebar.restoreFailed'), res.error);
                          }
                        }}
                        className="flex items-center space-x-1 text-d4-accent disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t('rightSidebar.restore')}</span>
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.electronAPI) return;
                          await window.electronAPI.deleteCheckpoint(cp.id);
                          refreshCheckpoints();
                        }}
                        className="flex items-center space-x-1 text-red-400/80 hover:text-red-400 ml-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{t('common.delete')}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- PREVIEW */}
        {/*
         * Nothing of this project's is serving yet: one button, one sentence,
         * both centred.
         *
         * The panel used to answer this case with an address bar, a row of port
         * chips and three buttons — tools for a page that was not there, over an
         * empty white frame that made the project look broken. The one thing the
         * user needs at that moment is the action that puts a page there.
         */}
        {activeTab === 'preview' && !hasPreviewTarget && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-d4-panel border border-d4-border rounded-md p-6 text-center min-h-[240px]">
            <button
              onClick={() => void launchPreview()}
              disabled={isLaunching || !projectPath}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-d4-accent text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-40"
              title={t('rightSidebar.launchPreview')}
            >
              <Play className={`w-4 h-4 ${isLaunching ? 'animate-pulse' : ''}`} />
              {isLaunching ? t('rightSidebar.launching') : t('rightSidebar.launchPreview')}
            </button>
            <p className="text-[11px] text-d4-muted max-w-[320px] leading-relaxed">
              {projectPath ? t('rightSidebar.previewEmptyHint') : t('rightSidebar.launchNeedsProject')}
            </p>
            <button
              onClick={() => void detectPreview(true)}
              className="text-[10px] text-d4-dimmed hover:text-d4-text underline underline-offset-2"
            >
              {t('rightSidebar.detect')}
            </button>
          </div>
        )}

        {activeTab === 'preview' && hasPreviewTarget && (
          <div className="flex-1 flex flex-col gap-1.5 p-2 min-h-0">
            {/*
             * A browser's tool row, in the order a browser has it: the address,
             * then what you can do with it. The address is a chip rather than a
             * raw input so that copying it — the thing people actually want — is
             * one click instead of a text selection.
             */}
            <div className="flex items-center gap-1 bg-d4-surface border border-d4-border rounded-md p-1 shrink-0">
              <Lock className="w-3 h-3 text-d4-dimmed shrink-0 ml-1" />
              <input
                type="text"
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                spellCheck={false}
                placeholder={t('rightSidebar.addressPlaceholder')}
                aria-label={t('rightSidebar.address')}
                className="flex-1 min-w-0 bg-transparent px-1 py-0.5 text-[11px] text-d4-text outline-none font-mono placeholder:text-d4-dimmed"
              />
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(previewUrl).then(
                    () => toast.success(t('rightSidebar.copied')),
                    () => toast.error(t('rightSidebar.copyFailed'))
                  );
                }}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded shrink-0"
                title={t('rightSidebar.copyUrl')}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  // A reload of an iframe means a fresh key, which remounts it.
                  if (!previewUrl) return;
                  setPreviewState('checking');
                  const url = previewUrl;
                  setPreviewUrl('');
                  setTimeout(() => setPreviewUrl(url), 0);
                }}
                disabled={!previewUrl}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded shrink-0 disabled:opacity-40"
                title={t('rightSidebar.reload')}
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => previewUrl && window.electronAPI?.openExternal(previewUrl)}
                disabled={!previewUrl}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded shrink-0 disabled:opacity-40"
                title={t('rightSidebar.openExternal')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => void detectPreview(true)}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded shrink-0"
                title={t('rightSidebar.detect')}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDetecting ? 'animate-spin' : ''}`} />
              </button>
              {/* Always reachable, not only when the panel has given up: a frame
                  can be answering with the wrong thing, and starting the
                  project's own server is the fix either way. */}
              <button
                onClick={() => void launchPreview()}
                disabled={isLaunching || !projectPath}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded shrink-0 disabled:opacity-40"
                title={t('rightSidebar.launchPreview')}
              >
                <Play className={`w-3.5 h-3.5 ${isLaunching ? 'animate-pulse' : ''}`} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-1 shrink-0">
              <div className="flex items-center gap-1">
                {PREVIEW_VIEWPORTS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setPreviewViewport(preset)}
                    title={t(`rightSidebar.viewport_${preset}`)}
                    className={`px-1.5 py-0.5 rounded-sm text-[10px] border ${
                      previewViewport === preset
                        ? 'border-d4-accent text-d4-accent'
                        : 'border-d4-border text-d4-muted hover:text-d4-text'
                    }`}
                  >
                    {t(`rightSidebar.viewportShort_${preset}`)}
                  </button>
                ))}
              </div>
              {detectedUrls.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {detectedUrls.slice(0, 3).map((url) => (
                    <button
                      key={url}
                      onClick={() => setPreviewUrl(url)}
                      className={`px-1.5 py-0.5 rounded-sm text-[10px] font-mono border ${
                        previewUrl === url ? 'border-d4-accent text-d4-accent' : 'border-d4-border text-d4-muted'
                      }`}
                    >
                      {url.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div
              ref={setFrameEl}
              className={`flex-1 bg-d4-panel rounded-md border border-d4-border min-h-[240px] relative flex justify-center ${
                presetWidthPx && fit < 1 ? 'overflow-hidden' : 'overflow-auto'
              }`}
            >
              {previewState === 'offline' || !previewUrl ? (
                <div className="h-full w-full bg-white">
                  <div className="h-full flex flex-col items-center justify-center gap-2 bg-d4-panel p-6 text-center">
                    <p className="text-xs text-d4-text font-medium">
                      {previewUrl ? t('rightSidebar.previewOffline') : t('rightSidebar.previewNoAddress')}
                    </p>
                    {previewUrl && (
                      <p className="text-[11px] text-d4-muted max-w-[280px] leading-relaxed font-mono">{previewUrl}</p>
                    )}
                    <p className="text-[11px] text-d4-muted max-w-[280px] leading-relaxed">
                      {previewUrl ? t('rightSidebar.previewOfflineHint') : t('rightSidebar.previewNoAddressHint')}
                    </p>
                    {detectedUrls.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-center max-w-[300px]">
                        {detectedUrls.slice(0, 4).map((url) => (
                          <button
                            key={url}
                            onClick={() => setPreviewUrl(url)}
                            className="px-2 py-0.5 rounded-sm text-[10px] font-mono border border-d4-border text-d4-muted hover:text-d4-text hover:border-d4-accent"
                          >
                            {url}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      {/* The panel's own way out: run the script the project
                          already declares, instead of telling the user to go and
                          do it in a terminal. */}
                      <button
                        onClick={() => void launchPreview()}
                        disabled={isLaunching || !projectPath}
                        className="px-2.5 py-1 rounded-md text-[11px] bg-d4-accent text-black font-medium hover:opacity-90 transition disabled:opacity-40"
                      >
                        {isLaunching ? t('rightSidebar.launching') : t('rightSidebar.launchPreview')}
                      </button>
                      <button
                        onClick={() => void probePreview(previewUrl)}
                        className="px-2.5 py-1 rounded-md text-[11px] border border-d4-border text-d4-text hover:border-d4-accent hover:text-d4-accent transition"
                      >
                        {t('rightSidebar.retry')}
                      </button>
                      <button
                        onClick={() => void detectPreview(true)}
                        className="px-2.5 py-1 rounded-md text-[11px] border border-d4-border text-d4-muted hover:text-d4-text transition"
                      >
                        {t('rightSidebar.detect')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* The stage is laid out at the preset's real width — the app
                      genuinely renders at 390px, it is not shown small — and the
                      transform shrinks that render to fit the panel. */}
                  <div
                    className="bg-white h-full w-full"
                    style={
                      presetWidthPx && frameSize.width > 0
                        ? {
                            width: presetWidthPx,
                            height: frameSize.height > 0 ? frameSize.height / fit : undefined,
                            transform: fit < 1 ? `scale(${fit})` : undefined,
                            transformOrigin: 'top left'
                          }
                        : undefined
                    }
                  >
                    <iframe
                      key={previewUrl}
                      src={previewUrl}
                      title="D4IDE Web Preview"
                      className="w-full h-full border-0 bg-white"
                    />
                  </div>
                  {previewState === 'checking' && (
                    // Otherwise a probe in flight looks like a blank page, and a
                    // blank page reads as a broken app rather than a slow one.
                    <div className="absolute inset-0 flex items-center justify-center bg-d4-bg/70 text-[11px] text-d4-muted gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      {t('rightSidebar.checking')}
                    </div>
                  )}
                  {presetWidthPx && fit < 1 && (
                    // Says what the chip did, in numbers: the layout width and
                    // the zoom it took to fit, so a scaled phone frame is read
                    // as chosen, not as broken.
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-sm bg-d4-bg/80 border border-d4-border text-[10px] font-mono text-d4-muted">
                      {presetWidthPx}px · {Math.round(fit * 100)}%
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------- TERMINAL */}
        {activeTab === 'terminal' && (
          <LazyPanel label={t('terminal.loading')}>
            <TerminalPanel variant="fill" />
          </LazyPanel>
        )}

        {/* ------------------------------------------------------------- GIT */}
        {activeTab === 'git' && <GitTab />}

        {/* ---------------------------------------------------------- RULES */}
        {activeTab === 'rules' && <RulesPanel projectPath={projectPath} />}

        {/* --------------------------------------------------------- SKILLS */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
              <span>{t('rightSidebar.skills')}</span>
              <button
                onClick={() =>
                  setEditingSkill({
                    id: `skill-${Date.now().toString(36)}`,
                    name: 'new-skill',
                    description: '',
                    content: '# New Skill\n\nDescribe what the agent should do.\n',
                    isGlobal: false
                  })
                }
                className="flex items-center space-x-1 text-d4-accent hover:underline normal-case"
              >
                <Plus className="w-3 h-3" />
                <span>{t('rightSidebar.addSkill')}</span>
              </button>
            </div>

            {editingSkill && (
              <div className="bg-d4-surface border border-d4-accent/50 rounded p-2.5 space-y-2">
                <div className="flex items-center space-x-1.5">
                  <input
                    value={editingSkill.id}
                    onChange={(e) => setEditingSkill({ ...editingSkill, id: e.target.value, name: e.target.value })}
                    className="flex-1 bg-d4-panel border border-d4-border rounded px-2 py-1 text-[11px] font-mono text-d4-text outline-none"
                    placeholder="skill-name"
                  />
                  <button onClick={() => setEditingSkill(null)} className="p-1 text-d4-dimmed hover:text-d4-text">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  value={editingSkill.description}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1 text-[11px] text-d4-text outline-none"
                  placeholder={t('rightSidebar.skillDescription')}
                />
                <textarea
                  value={editingSkill.content}
                  onChange={(e) => setEditingSkill({ ...editingSkill, content: e.target.value })}
                  rows={8}
                  className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none font-mono resize-none"
                />
                <button
                  onClick={async () => {
                    if (!window.electronAPI || !editingSkill.id.trim()) return;
                    const res = await window.electronAPI.saveSkill(editingSkill, projectPath || undefined);
                    if (res.success) {
                      toast.success(t('rightSidebar.skillSaved'));
                      setEditingSkill(null);
                      refreshSkills();
                    } else {
                      toast.error(t('rightSidebar.skillSaveFailed'), res.error);
                    }
                  }}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-d4-accent text-black font-semibold rounded text-[11px]"
                >
                  <Save className="w-3 h-3" />
                  <span>{t('common.save')}</span>
                </button>
              </div>
            )}

            <div className="space-y-2">
              {skills.length === 0 && !editingSkill && (
                <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('rightSidebar.noSkills')}</p>
              )}
              {skills.map((skill) => (
                <div key={`${skill.id}-${skill.isGlobal}`} className="bg-d4-surface border border-d4-border rounded p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <button
                      onClick={() => runSkill(skill)}
                      className="font-semibold text-d4-accent text-xs hover:underline"
                    >
                      /{skill.name}
                    </button>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[10px] text-d4-dimmed">
                        {skill.isGlobal ? t('rightSidebar.skillGlobal') : t('rightSidebar.skillProject')}
                      </span>
                      {!skill.isGlobal && (
                        <>
                          <button
                            onClick={() => setEditingSkill(skill)}
                            className="text-[10px] text-d4-dimmed hover:text-d4-text"
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.electronAPI) return;
                              await window.electronAPI.deleteSkill(skill.id, projectPath || undefined);
                              refreshSkills();
                            }}
                            className="text-d4-dimmed hover:text-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-d4-muted text-[11px] leading-relaxed">{skill.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
