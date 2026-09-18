import { BrowserWindow } from 'electron';
import {
  AgentMode,
  AgentStatus,
  AppSettings,
  AgentTimelineItem,
  AgentTodo,
  ApprovalRequest,
  ChatMessage,
  FileChange,
  ModelInfo,
  Mission,
  PermissionMode,
  PlanData,
  PlanDecision,
  PlanScope,
  PlanStepDecision,
  PromptImage,
  SessionTranscript,
  SubagentRole,
  ToolCall,
  ToolResult
} from '../../../shared/types';
import { IPC_CHANNELS } from '../../../shared/ipc-events';
import { providerManager, AutoRouteDecision } from '../providers/provider-manager';
import { IAIProvider, classifyThrownError } from '../providers/provider-interface';
import { toolRegistry, detectScriptCommand, hasPackageScript } from '../tools/tool-registry';
import { permissionEngine } from '../../security/permission-engine';
import { contextEngine } from '../context/context-engine';
import { SUBAGENTS, SubagentDefinition, buildSubagentSystemPrompt, getSubagent } from './subagents';
import { buildCompletionSummary } from './completion-summary';
import {
  RunLedger,
  loopNotice,
  repetitionNotice,
  reuseNotice,
  tokenDisciplineRules,
  compressForBudget
} from './token-discipline';
import { formatMission } from './mission-prompt';
import { ProjectMemory, buildMemoryBlock, memoryUpkeepRules, readProjectMemory } from '../../project/project-memory';
import { ProjectDesign, readProjectDesign, writeProjectDesign } from '../../project/design-store';
import { DESIGN_PROFILES, DesignStyle, buildDesignBrief, designQuestion } from '../../../shared/design-profiles';
import { logService } from '../../logging/log-service';
import { transcriptToConversation } from './session-history';
import { usageService, calculateCost, findModel } from '../usage/usage-service';
import { appStore } from '../../database/store';
import { fileService } from '../../filesystem/file-service';
import { gitService } from '../../git/git-service';
import path from 'path';
import fs from 'fs';

export interface AgentRunArgs {
  prompt: string;
  mode: AgentMode;
  projectPath: string;
  conversationHistory?: ChatMessage[];
  sessionId?: string;
  /** Images the user attached to this turn (spec §52). */
  images?: PromptImage[];
}

interface PendingApproval {
  id: string;
  resolve: (decision: 'approved' | 'approved_for_session' | 'rejected') => void;
  /** The request as it was sent, so a reloaded window can be asked again. */
  request: ApprovalRequest;
}

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'create_file', 'delete_file', 'move_file', 'git_commit']);

/** Upper bound on stored timeline items, so a very long run cannot bloat the transcript. */
const MAX_TRANSCRIPT_ITEMS = 400;
const TRANSCRIPT_FLUSH_MS = 800;

export class AgentRuntime {
  private abortController: AbortController | null = null;
  private status: AgentStatus = 'idle';
  private currentPlan: PlanData | null = null;
  private pendingPlanResolver: ((decision: PlanDecision) => void) | null = null;
  /** Waiting chooser for "which style should this project use" (spec §39). */
  private pendingDesignResolver: (() => void) | null = null;
  private pendingDesignProject: string | null = null;
  /** Resolver for the step-by-step gate between build steps (spec §35). */
  private pendingStepResolver: ((decision: PlanStepDecision) => void) | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();
  private sessionApprovals = new Set<string>();
  private currentTaskPrompt = '';
  private currentProjectPath = '';
  private currentMode: AgentMode = 'build';
  private currentSessionId = '';
  private currentProviderId = '';
  private currentModelId = '';
  private activeWindow: BrowserWindow | null = null;
  /** Files touched anywhere in this run, including by subagents. */
  private runAffectedFiles = new Set<string>();
  /** Builds/tests this run actually executed, for the completion summary (§88). */
  private runValidations: { command: string; ok: boolean }[] = [];
  /** Live transcript of the current session, flushed to disk while it runs. */
  private sessionTimeline: AgentTimelineItem[] = [];
  private sessionTodos: AgentTodo[] = [];
  private sessionPlan: PlanData | null = null;
  private transcriptTimer: NodeJS.Timeout | null = null;
  /** Guards against a subagent delegating again. */
  private subagentDepth = 0;
  /** Mission in force for the current session (spec §40). */
  private sessionMission: Mission | null = null;
  /**
   * What has already happened in this run, so a repeated read is answered from
   * memory and a repeated call is refused instead of paid for again (§39).
   */
  private ledger = new RunLedger();
  /** Set once per run: the trim is reported to the user a single time. */
  private contextTrimAnnounced = false;
  /**
   * `cancel()` aborts the controller *and* drops it, so "is this run aborted?"
   * could not be answered from the controller alone: the guard read `undefined`
   * and every cancelled step fell through to the provider-error branch. A user
   * who pressed stop (or closed the approval dialog) then saw "provider error"
   * instead of "stopped", and the run ended with no closing message at all.
   * This flag survives the controller being dropped.
   */
  private cancelled = false;
  /**
   * Why the current run stopped. The closing note in `run()` reads this so that
   * a run can never end silently — cancelled, out of budget and failed all say
   * so in the timeline (spec §84).
   */
  private stopReason: 'none' | 'completed' | 'cancelled' | 'budget' | 'error' = 'none';
  /** Set once the budget message has been shown, so it is not repeated per call. */
  private budgetStopAnnounced = false;
  /** Token accounting for the live meter and the per-run ceiling. */
  private runTokens = 0;
  private tokensSaved = 0;
  private lastPromptTokens = 0;
  private tokenMeterAnnounced = 0;
  /** Cached budget verdict, so the hot path does not re-aggregate usage. */
  private budgetCache: { exceeded: boolean; warn: boolean } | null = null;
  private budgetCacheAt = 0;
  private autoThriftAnnounced = false;

  /**
   * "/thrift" is a real switch, not a sentence in the prompt.
   *
   * It used to expand to a paragraph asking the model to be careful, which
   * changed nothing in the engine — the same prompt budget, the same number of
   * steps, the same reasoning effort. The user paid for a longer prompt and got
   * the same burn. Now it moves the actual dials.
   */
  private thriftActive(): boolean {
    return appStore.getSettings().thriftMode === true;
  }

  /** How many tokens of conversation a single request may carry. */
  private promptBudget(): number {
    const settings = appStore.getSettings();
    if (this.thriftLimits()) return Math.min(settings.contextTokenBudget || 48_000, 20_000);
    return settings.contextTokenBudget || 48_000;
  }

  /** Tokens this run may spend before it stops and says so (0 = no ceiling). */
  private runTokenCap(): number {
    const settings = appStore.getSettings();
    const configured = settings.runTokenBudget || 0;
    if (this.thriftLimits()) return configured > 0 ? Math.min(configured, 150_000) : 150_000;
    return configured;
  }

  /**
   * The configured cheap model, when it is usable.
   *
   * Format is `provider:model`; anything malformed, missing or without a key is
   * ignored rather than allowed to break a run that would otherwise work.
   */
  private cheapModel(): { providerId: string; modelId: string } | null {
    const raw = (appStore.getSettings().cheapModelId || '').trim();
    const sep = raw.indexOf(':');
    if (sep <= 0) return null;
    const providerId = raw.slice(0, sep);
    const modelId = raw.slice(sep + 1);
    if (!providerId || !modelId) return null;
    const config = providerManager.getConfig(providerId);
    if (!config || config.enabled === false) return null;
    return { providerId, modelId };
  }

  /**
   * The design instruction for this request.
   *
   * Three cases, and the token cost of each is deliberate: a chosen style sends
   * the full brief only when the work looks like UI; a chosen style on back-end
   * work sends one line (the project should still stay consistent); no style yet
   * sends the question the user asked to be asked.
   */
  private designBlock(design: ProjectDesign, isUiWork: boolean, language: 'th' | 'en'): string {
    const th = language === 'th';
    const settings = appStore.getSettings();
    const chosen = design.style !== 'ask';
    const fallback = settings.designStyle === 'ask' ? 'minimal' : settings.designStyle;

    if (!chosen) {
      // The user asked to be asked: one short question beats a page they did not
      // want, and the answer is remembered for this project afterwards.
      if (isUiWork && settings.askDesignBeforeUiWork !== false) {
        return `\n\n${designQuestion(language)}\n${th ? `· ใช้ค่าเริ่มต้น (${DESIGN_PROFILES[fallback].label.th})` : `· Use the default (${DESIGN_PROFILES[fallback].label.en})`}`;
      }
      // No choice recorded and no question asked: fall back to the app default
      // rather than inventing a look.
      if (isUiWork) return `\n\n${buildDesignBrief(fallback, language)}`;
      return '';
    }

    const style = design.style === 'ask' ? fallback : design.style;
    const profile = DESIGN_PROFILES[style];
    const notes = design.notes?.trim() ? `\n${th ? 'เพิ่มเติมจากผู้ใช้' : 'User additions'}: ${design.notes.trim()}` : '';
    if (!isUiWork) {
      return `\n\n${th ? 'สไตล์ของโปรเจกต์นี้' : 'This project’s style'}: ${profile.label[language]} — ${th ? 'ถ้างานนี้แตะ UI ให้ยึดตามโปรไฟล์นี้ (เรียก /design เพื่อดูรายละเอียด)' : 'if this task touches UI, stay inside this profile (run /design for the full brief)'}.`;
    }
    return `\n\n${buildDesignBrief(style, language)}${notes}`;
  }

  private emitTokenStats(mainWindow: BrowserWindow | null | undefined, language: 'th' | 'en'): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, {
      type: 'stats',
      stats: {
        runTokens: this.runTokens,
        cap: this.runTokenCap(),
        saved: this.tokensSaved,
        promptTokens: this.lastPromptTokens,
        thrift: this.thriftLimits(),
        autoThrift: !this.thriftActive() && this.thriftLimits()
      },
      language
    });
  }
  /** Last permission mode this run observed, to announce a mid-run switch once. */
  private lastPermissionMode: PermissionMode | null = null;
  /**
   * Identity of the running loop. A run that is superseded by a newer one (the
   * user sent another message, or a queued task started) has to notice, even
   * though `cancel()` cleared the flag and handed the controller to the new run.
   */
  private runToken = 0;
  /**
   * Structured-log sink, wired by the module bottom. A settable hook keeps this
   * class free of a hard dependency on the file system when it is under test.
   */
  onLog: (
    channel: 'agent' | 'provider' | 'terminal',
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ) => void = () => undefined;

  constructor() {
    // The registry reaches back into the runtime for delegation, because the
    // runtime owns the provider connection, the budget and the approval gate.
    toolRegistry.setSubagentRunner((args, projectPath) => this.runSubagentTool(args, projectPath));
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * True once the user has stopped this run. Deliberately independent of
   * `abortController`, which `cancel()` clears.
   */
  private isCancelled(token?: number): boolean {
    if (this.cancelled) return true;
    // A newer run has taken over: this one is over even though the shared
    // controller now belongs to someone else.
    if (token !== undefined && token !== this.runToken) return true;
    return this.abortController?.signal.aborted === true;
  }

  getSessionId(): string {
    return this.currentSessionId;
  }

  getSessionState() {
    return {
      sessionId: this.currentSessionId,
      providerId: this.currentProviderId,
      modelId: this.currentModelId,
      projectPath: this.currentProjectPath,
      mode: this.currentMode,
      status: this.status,
      // A dialog the renderer is not showing — it reloaded, or it never got the
      // event — is a run waiting forever with nothing on screen. The window can
      // ask for it back instead.
      pendingApproval: this.pendingApprovalPayload()
    };
  }

  /** The oldest approval still waiting for an answer, if any. */
  pendingApprovalPayload(): ApprovalRequest | null {
    const first = this.pendingApprovals.values().next();
    return first.done ? null : first.value.request;
  }

  cancel(): void {
    // Set before the abort so a provider call that fails *because* of it is
    // reported as a cancellation, not as the provider breaking.
    this.cancelled = true;
    if (this.stopReason !== 'budget') this.stopReason = 'cancelled';
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver({ action: 'cancel' });
      this.pendingPlanResolver = null;
    }
    if (this.pendingStepResolver) {
      this.pendingStepResolver('stop');
      this.pendingStepResolver = null;
    }
    if (this.pendingDesignResolver) {
      this.pendingDesignResolver();
      this.pendingDesignResolver = null;
      this.pendingDesignProject = null;
    }
    for (const [, pending] of this.pendingApprovals) {
      pending.resolve('rejected');
    }
    this.pendingApprovals.clear();
    this.dismissDialogs(this.activeWindow);
    this.status = 'cancelled';
  }

  /**
   * Clears approval dialogs that are waiting, because the user just widened the
   * permission mode to Full. Returns how many were waiting — zero is normal and
   * means no dialog was on screen.
   */
  approveAllPending(decision: 'approved' | 'approved_for_session' = 'approved', mainWindow?: BrowserWindow): number {
    const pending = Array.from(this.pendingApprovals.values());
    for (const entry of pending) entry.resolve(decision);
    this.pendingApprovals.clear();
    // Answering a dialog on the user's behalf is only half the job: the modal
    // lives in the renderer, and leaving it on screen would keep blocking the
    // window that was just unblocked. `null` tells the renderer to take it down.
    this.dismissDialogs(mainWindow ?? this.activeWindow);
    return pending.length;
  }

  /**
   * Takes down an approval modal the renderer is still showing. Called whenever
   * the request behind it was answered somewhere other than the dialog itself —
   * switching to Full, cancelling the run, or starting a new one.
   */
  private dismissDialogs(mainWindow?: BrowserWindow | null): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    this.send(mainWindow, IPC_CHANNELS.AGENT_APPROVAL_REQUEST, null);
  }

  /**
   * Answers the plan card. `scope` says how far the run may go before it stops
   * and asks again, which is what makes "approve" mean more than one thing.
   */
  approvePlan(scope: PlanScope = 'full'): void {
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver({ action: 'approve', scope });
      this.pendingPlanResolver = null;
    }
  }

  /** Sends the plan back with a note instead of accepting or discarding it. */
  revisePlan(feedback: string): void {
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver({ action: 'revise', feedback });
      this.pendingPlanResolver = null;
    }
  }

  rejectPlan(): void {
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver({ action: 'cancel' });
      this.pendingPlanResolver = null;
    }
  }

  /**
   * Does this project already have an interface?
   *
   * Bounded and short-circuiting: it walks a few conventional roots three levels
   * deep and stops at the first component or stylesheet, so the cost is a couple
   * of directory reads rather than a scan of the repository. The answer decides
   * whether an unnamed UI task still needs the style question.
   */
  private projectHasUiSource(projectPath: string): boolean {
    const uiFile = /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less)$/i;
    const seen = new Set<string>();
    const walk = (directory: string, depth: number): boolean => {
      if (depth > 3 || seen.has(directory)) return false;
      seen.add(directory);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return false;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (entry.isFile() && uiFile.test(entry.name)) return true;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (walk(path.join(directory, entry.name), depth + 1)) return true;
      }
      return false;
    };
    return ['src', 'app', 'pages', 'components', 'lib', ''].some((root) =>
      walk(path.join(projectPath, root), 0)
    );
  }

  /**
   * Raises the style chooser and waits for the answer.
   *
   * The user should not have to type their design preference into every prompt,
   * and the agent should not invent one: so on the first UI request in a project
   * with nothing recorded, it asks. The answer is written to the project's
   * `.d4ide/design.json`, which is what makes it a one-time question.
   */
  private askDesignStyle(
    mainWindow: BrowserWindow,
    projectPath: string,
    language: 'th' | 'en'
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingDesignProject = projectPath;
      this.pendingDesignResolver = () => resolve(true);
      this.sendEvent(mainWindow, {
        id: `design_card_${Date.now()}`,
        type: 'design',
        title: language === 'th' ? 'เลือกสไตล์หน้าจอให้โปรเจกต์นี้' : 'Choose this project’s screen style',
        content:
          language === 'th'
            ? 'เลือกครั้งเดียวแล้วจำไว้ให้โปรเจกต์นี้ — ทุกงานที่แตะหน้าจอหลังจากนี้จะยึดสไตล์นี้ให้เอง ไม่ต้องสั่งซ้ำทุกครั้ง'
            : 'Answered once and remembered for this project — every later task that touches the screen follows it, with no need to repeat yourself.',
        details: { projectPath, language },
        timestamp: Date.now()
      });
      this.sendStatus(mainWindow, 'waiting_approval');
    });
  }

  /** Records the style picked from the chooser card and releases the run. */
  chooseDesignStyle(style: Exclude<DesignStyle, 'ask'>): boolean {
    const resolver = this.pendingDesignResolver;
    const projectPath = this.pendingDesignProject;
    if (!resolver || !projectPath) return false;
    this.pendingDesignResolver = null;
    this.pendingDesignProject = null;
    try {
      writeProjectDesign(projectPath, { style });
    } catch (error) {
      // A read-only checkout still works: the choice just does not persist.
      this.onLog('agent', 'warn', 'Design choice could not be saved', {
        projectPath,
        error: (error as Error)?.message
      });
    }
    resolver();
    return true;
  }

  /**
   * Answers a step gate: `continue` runs exactly one more step, `runAll` drops
   * the gate for the rest of the plan, `stop` ends the run where it stands.
   */
  resolvePlanStep(decision: PlanStepDecision): boolean {
    const resolver = this.pendingStepResolver;
    if (!resolver) return false;
    this.pendingStepResolver = null;
    resolver(decision);
    return true;
  }

  resolveApproval(id: string, decision: 'approved' | 'approved_for_session' | 'rejected', toolName?: string): boolean {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return false;
    if (decision === 'approved_for_session' && toolName) {
      this.sessionApprovals.add(toolName);
    }
    pending.resolve(decision);
    this.pendingApprovals.delete(id);
    return true;
  }

  // ------------------------------------------------------------- emitters

  private send(mainWindow: BrowserWindow, channel: string, payload: unknown): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  }

  private sendEvent(mainWindow: BrowserWindow, item: AgentTimelineItem): void {
    this.recordTimelineItem(item);
    this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, { type: 'timeline', item });
  }

  private sendStatus(mainWindow: BrowserWindow, status: AgentStatus): void {
    this.status = status;
    this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, { type: 'status', status });
  }

  private sendTodos(mainWindow: BrowserWindow, todos: AgentTodo[]): void {
    this.sessionTodos = todos;
    this.scheduleTranscriptFlush();
    this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, { type: 'todos', todos });
  }

  private sendFileChange(mainWindow: BrowserWindow, change: FileChange): void {
    this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, { type: 'file_change', change });
  }

  // -------------------------------------------------------- plan scoping

  /**
   * The message that carries an approval into the build loop. The scope has to
   * reach the model, not just the runtime: a model that believes it owns the
   * whole plan will happily implement all of it inside a single step.
   */
  private planApprovalMessage(planText: string, scope: PlanScope): string {
    const header = `The user has approved the plan:\n${planText}\n`;
    if (scope === 'step') {
      return `${header}\nThe user wants to review each step before it runs: implement exactly ONE step, then stop and report what changed so they can approve the next one. Do not start the following step.`;
    }
    if (scope === 'first') {
      return `${header}\nThe user approved the FIRST step only: implement step 1, then stop and report. Do not begin step 2 or any later step.`;
    }
    return `${header}\nPlease proceed with the implementation in Build Mode now.`;
  }

  /**
   * Pauses between build steps when the plan was approved step-by-step, and
   * waits for the user. The run is parked in `paused`, not cancelled, so the
   * session stays resumable and nothing in flight is discarded.
   */
  private async awaitPlanStepGate(
    mainWindow: BrowserWindow,
    language: 'th' | 'en',
    step: number
  ): Promise<PlanStepDecision> {
    this.sendEvent(mainWindow, {
      id: `step_gate_${Date.now()}`,
      type: 'plan',
      title: language === 'th' ? `จบขั้นตอนที่ ${step} แล้ว` : `Step ${step} finished`,
      content:
        language === 'th'
          ? 'ตรวจผลลัพธ์ด้านบนแล้วเลือกว่าจะให้ทำขั้นตอนถัดไป หรือให้ทำจนจบแผน'
          : 'Review the result above, then choose whether the next step should run.',
      details: { kind: 'step_gate', step, language },
      timestamp: Date.now()
    });

    this.sendStatus(mainWindow, 'paused');

    const decision = await new Promise<PlanStepDecision>((resolve) => {
      this.pendingStepResolver = resolve;
    });

    if (decision !== 'stop') this.sendStatus(mainWindow, 'running');
    return decision;
  }

  /**
   * The budget stop, spelled out. The user asked for work that then stopped on
   * a spending limit; the numbers, where to change them, and the fact that the
   * work so far is kept all have to be in the timeline for that to make sense.
   */
  private budgetStopItem(language: 'th' | 'en'): AgentTimelineItem {
    const budget = usageService.summary(this.currentSessionId).budget;
    const spentToday = budget.dailySpent.toFixed(2);
    const limit = budget.daily;
    const nextStep =
      language === 'th'
        ? 'งานที่ทำไปแล้วถูกบันทึกไว้ทั้งหมด ไปที่ การตั้งค่า → การใช้งานและงบประมาณ เพื่อเพิ่มวงเงิน แล้วส่งข้อความอีกครั้งเพื่อทำต่อจากจุดนี้'
        : 'Everything done so far is saved. Raise the limit in Settings → Usage & Budget, then send another message to continue from here.';
    return {
      id: `budget_stop_${Date.now()}`,
      type: 'error',
      title: language === 'th' ? 'หยุดเพราะถึงขีดจำกัดงบประมาณ' : 'Stopped: budget limit reached',
      content:
        language === 'th'
          ? `ใช้ไป $${spentToday} จากวงเงิน $${limit} ต่อวัน จึงหยุดที่ขั้นตอนนี้ (โทเคนและไฟล์ที่แก้แล้วยังอยู่ครบ)\n${nextStep}`
          : `Spent $${spentToday} of the $${limit} daily budget, so the run stopped at this step (tokens and file changes are intact).\n${nextStep}`,
      timestamp: Date.now()
    };
  }

  /**
   * No run ends without saying so. A cancelled, out-of-budget or failed run used
   * to leave the transcript hanging on whatever the last tool printed — which is
   * indistinguishable from "nothing happened" (spec §84).
   */
  private emitStopNote(mainWindow: BrowserWindow, language: 'th' | 'en'): void {
    if (this.stopReason === 'none' || this.stopReason === 'completed') return;
    if (this.status === 'completed') return;

    const changed = this.runAffectedFiles.size;
    const th = language === 'th';
    const bodies: Record<'cancelled' | 'budget' | 'error', string> = {
      cancelled: th
        ? `หยุดตามที่คุณสั่งครับ งานที่ทำเสร็จแล้ว ${changed} ไฟล์ถูกบันทึกไว้ \nส่งข้อความใหม่ในเซสชันนี้เพื่อทำต่อจากจุดเดิมได้เลย`
        : `Stopped at your request. ${changed} file(s) already changed are saved.\nSend another message in this session to continue from here.`,
      budget: th
        ? 'หยุดเพราะถึงขีดจำกัดงบประมาณ — ดูรายละเอียดด้านบน แล้วเพิ่มวงเงินที่ การตั้งค่า → การใช้งานและงบประมาณ'
        : 'Stopped by the spending limit — see above, then raise it in Settings → Usage & Budget.',
      error: th
        ? `การทำงานหยุดเพราะข้อผิดพลาดของผู้ให้บริการ งานที่ทำไปแล้ว ${changed} ไฟล์ถูกเก็บไว้ \nแก้สาเหตุ (คีย์/โมเดล/เครือข่าย) แล้วส่งข้อความอีกครั้งเพื่อทำต่อ`
        : `The run stopped on a provider error. ${changed} file(s) were kept.\nFix the cause (key, model, network), then send another message to continue.`
    };

    const titles: Record<'cancelled' | 'budget' | 'error', [string, string]> = {
      cancelled: ['หยุดการทำงานแล้ว', 'Run stopped'],
      budget: ['หยุดเพราะงบประมาณ', 'Stopped by budget'],
      error: ['การทำงานสิ้นสุดด้วยข้อผิดพลาด', 'Run ended with an error']
    };

    const reason = this.stopReason;
    this.sendEvent(mainWindow, {
      id: `stop_note_${Date.now()}`,
      type: 'message',
      title: th ? titles[reason][0] : titles[reason][1],
      content: bodies[reason],
      timestamp: Date.now()
    });
  }

  /**
   * The permission mode is read live, once per tool call.
   *
   * It used to be captured when the run started, so switching to "Full" in
   * Settings changed nothing until the next message: the user was still stopped
   * by approval dialogs while the UI said Full. Reading it here means the switch
   * applies to the very next tool — and the change is announced in the timeline
   * so it cannot look like the gate was ignored.
   */
  private livePermissionMode(mainWindow?: BrowserWindow, language: 'th' | 'en' = 'en'): PermissionMode {
    const mode = appStore.getSettings().permissionMode;
    if (mode !== this.lastPermissionMode) {
      if (this.lastPermissionMode !== null && mainWindow) {
        const th = language === 'th';
        const labels: Record<PermissionMode, [string, string]> = {
          safe: ['ปลอดภัย (Safe) — ถามก่อนทุกการเขียน', 'Safe — ask before every write'],
          ask: ['ถามก่อนทุกครั้ง (Ask)', 'Ask — confirm each action'],
          full: ['เต็มรูปแบบ (Full) — ไม่ถามอีก', 'Full — no more prompts']
        };
        this.sendEvent(mainWindow, {
          id: `perm_${Date.now()}`,
          type: 'thinking',
          title: th ? 'เปลี่ยนระดับสิทธิ์การทำงาน' : 'Permission mode changed',
          content: th
            ? `ผู้ใช้สลับเป็น ${labels[mode][0]} — มีผลทันทีกับการเรียกเครื่องมือครั้งถัดไป`
            : `The user switched to ${labels[mode][1]} — effective from the next tool call.`,
          timestamp: Date.now()
        });
      }
      this.lastPermissionMode = mode;
    }
    return mode;
  }

  private errorItem(title: string, content: string): AgentTimelineItem {
    return { id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'error', title, content, timestamp: Date.now() };
  }

  // ------------------------------------------------------------- transcript

  /**
   * Session transcripts are written while the run is still in flight (spec §45,
   * §84): a crash, a killed process or a closed window must not lose the trail,
   * and a finished transcript is what makes "resume" meaningful.
   */
  private recordTimelineItem(item: AgentTimelineItem): void {
    this.sessionTimeline.push(item);
    if (this.sessionTimeline.length > MAX_TRANSCRIPT_ITEMS) {
      this.sessionTimeline.splice(0, this.sessionTimeline.length - MAX_TRANSCRIPT_ITEMS);
    }
    if (item.type === 'plan' && item.details) this.sessionPlan = item.details as PlanData;
    this.scheduleTranscriptFlush();
  }

  private scheduleTranscriptFlush(): void {
    if (this.transcriptTimer) return;
    // Coalesce bursts of events into one write without delaying the final flush.
    this.transcriptTimer = setTimeout(() => {
      this.transcriptTimer = null;
      this.writeTranscript(false);
    }, TRANSCRIPT_FLUSH_MS);
    this.transcriptTimer.unref?.();
  }

  private writeTranscript(endedCleanly: boolean): void {
    if (!this.currentSessionId) return;
    try {
      appStore.saveSessionTranscript(this.currentSessionId, {
        sessionId: this.currentSessionId,
        projectPath: this.currentProjectPath,
        timeline: this.sessionTimeline,
        todos: this.sessionTodos,
        plan: this.sessionPlan,
        mission: this.sessionMission,
        updatedAt: Date.now(),
        endedCleanly
      } satisfies SessionTranscript);
    } catch (e) {
      console.warn('Failed to persist the session transcript:', e);
    }
  }

  /**
   * Loads whatever is already on disk for this session so a resumed run appends
   * to the history instead of overwriting it.
   */
  private loadTranscript(sessionId: string): SessionTranscript | null {
    const existing = appStore.getSessionTranscript<SessionTranscript>(sessionId);
    if (!existing) return null;
    // Copies, never the stored objects themselves: this run appends to the trail,
    // and a shared array would also rewrite the snapshot we replay the model from.
    this.sessionTimeline = Array.isArray(existing.timeline) ? [...existing.timeline] : [];
    this.sessionTodos = Array.isArray(existing.todos) ? [...existing.todos] : [];
    this.sessionPlan = existing.plan ?? null;
    return {
      ...existing,
      timeline: [...this.sessionTimeline],
      todos: [...this.sessionTodos]
    };
  }

  // ------------------------------------------------------- provider helpers

  /**
   * Decide which provider/model serves this run. `auto` consults the routing
   * profile and the decision is reported to the user (spec §33/§34).
   */
  private resolveTarget(
    mainWindow: BrowserWindow,
    language: 'th' | 'en'
  ): { providerId: string; modelId: string; provider: IAIProvider } | { error: string } {
    const settings = appStore.getSettings();
    let providerId = settings.activeProviderId;
    let modelId = settings.activeModelId;

    if (providerId === 'auto' || modelId === 'auto') {
      const decision: AutoRouteDecision = providerManager.resolveAutoModel(settings.routingProfile);
      providerId = decision.providerId;
      modelId = decision.modelId;
      this.sendEvent(mainWindow, {
        id: `route_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'เลือกโมเดลอัตโนมัติ' : 'Auto model routing',
        content: decision.reason,
        timestamp: Date.now()
      });
    }

    let provider = providerManager.getProvider(providerId);
    let usables = providerManager.getUsableProviders();

    if (!provider || !providerManager.getConfig(providerId)?.enabled) {
      const chain = [...settings.fallbackChain, ...usables.map((p) => p.id)];
      const nextId = chain.find((id) => providerManager.getProvider(id));
      if (nextId) {
        const config = providerManager.getConfig(nextId);
        modelId = config?.models[0]?.id ?? modelId;
        providerId = nextId;
        provider = providerManager.getProvider(nextId);
        this.sendEvent(mainWindow, {
          id: `fallback_${Date.now()}`,
          type: 'thinking',
          title: language === 'th' ? 'สลับผู้ให้บริการ' : 'Provider fallback',
          content:
            language === 'th'
              ? `ไม่พบผู้ให้บริการ "${settings.activeProviderId}" — ใช้ ${config?.name ?? nextId} แทน`
              : `Provider "${settings.activeProviderId}" unavailable — using ${config?.name ?? nextId} instead.`,
          timestamp: Date.now()
        });
      }
    }

    if (!provider) {
      return { error: this.noProviderMessage(language) };
    }

    const config = providerManager.getConfig(providerId);

    // Refuse to fire a request that cannot succeed for a reason we already know.
    // Each branch names the fix instead of surfacing a 401 or a hang later.
    if (config) {
      if (config.requiresApiKey && !config.apiKey) {
        return {
          error:
            language === 'th'
              ? `${config.name} ยังไม่ได้ใส่ API key — ไปที่ Settings → AI Providers เพื่อเพิ่มคีย์`
              : `${config.name} has no API key yet — open Settings → AI Providers to add one.`
        };
      }
      if (config.type === 'ollama' && config.status !== 'connected') {
        return { error: this.unverifiedLocalMessage(config.name, language) };
      }
      if (appStore.isFreshError(config)) {
        // Not fatal: the user may have fixed the endpoint without re-testing.
        // Only a recent verdict is worth saying out loud — an old one has already
        // expired for the provider hub, and a provider that has answered since is
        // healed by the next successful call rather than nagged about here.
        this.sendEvent(mainWindow, {
          id: `stale_status_${Date.now()}`,
          type: 'thinking',
          title: language === 'th' ? 'ผู้ให้บริการเคยทดสอบไม่ผ่าน' : 'Provider last failed its test',
          content:
            (language === 'th'
              ? `การทดสอบครั้งล่าสุดของ ${config.name} ไม่ผ่าน — กำลังลองใช้อยู่`
              : `${config.name} failed its last connection test — trying it anyway.`) +
            (config.lastError ? ` (${config.lastError})` : ''),
          timestamp: Date.now()
        });
      }
    }

    // The chosen model may not exist on the resolved provider.
    if (config && !config.models.some((m) => m.id === modelId)) {
      modelId = config.models[0]?.id ?? modelId;
    }

    return { providerId, modelId, provider };
  }

  /**
   * Why nothing can run. A keyless local server is the common cause on a fresh
   * install: it is configured, but we have never seen it answer.
   */
  private noProviderMessage(language: 'th' | 'en'): string {
    const local = appStore
      .getProviders()
      .find((p) => p.enabled && p.type === 'ollama' && p.status !== 'connected' && p.models.length > 0);

    const base =
      language === 'th'
        ? 'ยังไม่ได้ตั้งค่าผู้ให้บริการ AI — ไปที่ Settings → AI Providers เพื่อเชื่อมต่อ API'
        : 'No AI provider is configured. Open Settings → AI Providers to connect an API.';

    if (!local) return base;

    return `${base}${
      language === 'th'
        ? ` ถ้าใช้โมเดลในเครื่อง ให้กด "ทดสอบ" ที่ ${local.name} เพื่อเริ่มใช้งาน`
        : ` If you run models locally, press "Test" on ${local.name} to start using it.`
    }`;
  }

  private unverifiedLocalMessage(providerName: string, language: 'th' | 'en'): string {
    return language === 'th'
      ? `${providerName} ยังไม่ได้รับการยืนยันว่าทำงานอยู่ — ไปที่ Settings → AI Providers แล้วกด "ทดสอบ" เพื่อเริ่มใช้งาน`
      : `${providerName} has not been confirmed reachable yet — open Settings → AI Providers and run "Test" to start using it.`;
  }

  private priceModel(providerId: string, modelId: string): ModelInfo | undefined {
    return findModel(appStore.getProviders(), providerId, modelId);
  }

  /** Turn a raw provider/network failure into something the user can act on (spec §54). */
  private describeFailure(providerName: string, error: unknown, language: 'th' | 'en'): string {
    const kind = classifyThrownError(error);
    const hints: Record<string, { th: string; en: string }> = {
      invalid_key: {
        th: 'API key ไม่ถูกต้องหรือถูกปฏิเสธ — ไปที่ Settings → AI Providers แล้วตรวจสอบคีย์',
        en: 'API key is invalid or rejected — open Settings → AI Providers and check the key'
      },
      rate_limit: {
        th: 'ถูกจำกัดอัตราการเรียก — ลองใหม่หรือสลับโมเดล',
        en: 'Rate limited — retry or switch to another model'
      },
      unavailable: {
        th: 'เชื่อมต่อผู้ให้บริการไม่ได้ — ตรวจสอบว่าเซิร์ฟเวอร์ทำงานอยู่และ Base URL ถูกต้อง',
        en: 'Provider is unreachable — check that it is running and the Base URL is correct'
      },
      timeout: {
        th: 'หมดเวลารอการตอบกลับ — ลองใหม่หรือลดบริบท',
        en: 'The request timed out — retry or reduce the context'
      },
      model_not_found: {
        th: 'ไม่พบโมเดลนี้ในผู้ให้บริการ — เลือกโมเดลอื่นหรือดึงรายชื่อโมเดลใหม่',
        en: 'This model does not exist on the provider — pick another or fetch the model list'
      },
      context_exceeded: {
        th: 'บริบทเกินขีดจำกัดของโมเดล — ลดไฟล์หรือประวัติที่อ้างอิง',
        en: 'Context window exceeded — reference fewer files or clear history'
      },
      bad_request: {
        th: 'ผู้ให้บริการปฏิเสธคำขอ',
        en: 'The provider rejected the request as invalid'
      },
      unknown: {
        th: 'เกิดข้อผิดพลาดจากผู้ให้บริการ',
        en: 'The provider returned an unexpected error'
      }
    };
    const hint = hints[kind] ?? hints.unknown;
    const message = error instanceof Error ? error.message : String(error ?? '');
    const detail = message && !hint.en.includes(message) ? ` (${message})` : '';
    return `${providerName}: ${language === 'th' ? hint.th : hint.en}${detail}`;
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    retryLimit: number,
    onRetry?: (attempt: number, delayMs: number, kind: string) => void,
    token?: number
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        const kind = classifyThrownError(e);
        const retryable = kind === 'rate_limit' || kind === 'unavailable' || kind === 'timeout' || kind === 'unknown';
        if (!retryable || attempt >= retryLimit || this.isCancelled(token)) throw e;
        attempt++;
        const delay = Math.min(8000, 500 * Math.pow(2, attempt));
        onRetry?.(attempt, delay, kind);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /** Runs a provider call and records token usage even when it fails (spec §35). */
  private async runProviderCall(
    mainWindow: BrowserWindow,
    provider: IAIProvider,
    providerId: string,
    modelId: string,
    request: Parameters<IAIProvider['streamChat']>[0],
    onChunk: (chunk: Parameters<Parameters<IAIProvider['streamChat']>[1]>[0]) => void,
    meta: { mode: AgentMode; startedAt: number; label: string; token?: number }
  ): Promise<void> {
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;

    // A retried call is a new provider request, so tokens are counted per attempt.
    // The timeline note keeps that from looking like one oversized call.
    const language = appStore.getSettings().language;

    // Bound the prompt before it is paid for. Growth comes from the model's own
    // earlier tool calls — chiefly the files it wrote — and every request resends
    // all of it, so this is where a long run stops being affordable (§39).
    const budget = this.promptBudget();
    const trimmed = compressForBudget(request.messages, {
      maxTokens: budget,
      maxToolChars: this.thriftLimits() ? 800 : 2500,
      keepRecent: this.thriftLimits() ? 4 : 8
    });
    if (trimmed.dropped > 0 || trimmed.truncated > 0 || trimmed.argumentCharsSaved > 0) {
      request = { ...request, messages: trimmed.messages };
      this.tokensSaved += trimmed.tokensBefore - trimmed.tokensAfter;
      this.lastPromptTokens = trimmed.tokensAfter;
      if (!this.contextTrimAnnounced) {
        this.contextTrimAnnounced = true;
        this.sendEvent(mainWindow, {
          id: `trim_${Date.now()}`,
          type: 'thinking',
          title: language === 'th' ? 'ย่อบริบทเพื่อประหยัดโทเคน' : 'Trimmed context to save tokens',
          content:
            language === 'th'
              ? `ย่อคำขอก่อนส่ง: คำสั่งเก่า ${trimmed.dropped} รายการ · ผลลัพธ์เครื่องมือ ${trimmed.truncated} รายการ · ` +
                `เนื้อไฟล์ที่ส่งซ้ำ ${Math.round(trimmed.argumentCharsSaved / 1000)} พันตัวอักษร — รวมประหยัดประมาณ ${trimmed.tokensBefore - trimmed.tokensAfter} โทเคนต่อคำขอ`
              : `Prompt compressed before sending: ${trimmed.dropped} old message(s), ${trimmed.truncated} tool result(s) and ` +
                `${Math.round(trimmed.argumentCharsSaved / 1000)}K characters of repeated file contents — about ` +
                `${trimmed.tokensBefore - trimmed.tokensAfter} tokens saved per request.`,
          timestamp: Date.now()
        });
      }
      this.emitTokenStats(mainWindow, language);
    }

    try {
      await this.withRetry(
        () =>
          provider.streamChat(request, (chunk) => {
            if (chunk.usage) {
              promptTokens += chunk.usage.promptTokens;
              completionTokens += chunk.usage.completionTokens;
              cachedTokens += chunk.usage.cachedPromptTokens || 0;
            }
            onChunk(chunk);
          }),
        appStore.getSettings().retryLimit ?? 2,
        (attempt, delayMs, kind) => {
          // Provider errors get their own log stream: they are mostly keys,
          // quotas and connectivity, which is a different question from "what
          // did the agent do" (spec §66).
          this.onLog('provider', attempt > 1 ? 'warn' : 'error', 'Provider call failed, retrying', {
            providerId,
            modelId,
            kind,
            attempt,
            delayMs,
            label: meta.label
          });
          this.sendEvent(mainWindow, {
            id: `retry_${Date.now()}_${attempt}`,
            type: 'thinking',
            title: language === 'th' ? 'กำลังลองใหม่' : 'Retrying provider call',
            content:
              language === 'th'
                ? `ผู้ให้บริการล้มเหลว (${kind}) — ลองครั้งที่ ${attempt} ในอีก ${Math.round(delayMs / 1000)} วินาที (โทเคนที่ใช้ไปจะยังถูกบันทึก)`
                : `Provider failed (${kind}) — retry ${attempt} in ${Math.round(delayMs / 1000)}s. Tokens already consumed are still recorded.`,
            status: 'running',
            timestamp: Date.now()
          });
        },
        meta.token
      );
      this.recordUsage(providerId, modelId, { promptTokens, completionTokens, cachedTokens }, 'completed', meta);
      this.healProviderStatus(providerId);
    } catch (e) {
      this.recordUsage(providerId, modelId, { promptTokens, completionTokens, cachedTokens }, 'failed', meta);
      this.onLog('provider', 'error', 'Provider call failed', {
        providerId,
        modelId,
        label: meta.label,
        error: (e as Error)?.message
      });
      throw e;
    }
  }

  /**
   * A provider whose last connection test failed but which has just answered a
   * real request is working. Clear the stale record, otherwise one bad test — an
   * expired key, a gateway hiccup, a build that shipped without a required header
   * — keeps warning the user and keeps the hub showing a red dot forever, even
   * though every turn since has succeeded.
   */
  private healProviderStatus(providerId: string): void {
    const config = providerManager.getConfig(providerId);
    if (!config || config.status === 'connected') return;
    appStore.updateProviderMeta(providerId, {
      status: 'connected',
      lastError: undefined,
      lastTestedAt: Date.now()
    });
  }

  private recordUsage(
    providerId: string,
    modelId: string,
    tokens: { promptTokens: number; completionTokens: number; cachedTokens: number },
    status: 'completed' | 'failed' | 'cancelled' | 'partial',
    meta: { mode: AgentMode; startedAt: number; label: string }
  ): void {
    if (tokens.promptTokens === 0 && tokens.completionTokens === 0) return;

    // The meter counts every token the run actually pays for, including the
    // cached ones (they are cheaper, not free) — this is what the ceiling and
    // the status bar read.
    this.runTokens += tokens.promptTokens + tokens.completionTokens;

    const model = this.priceModel(providerId, modelId);
    const providerConfig = providerManager.getConfig(providerId);
    const cost = calculateCost(model, {
      inputTokens: tokens.promptTokens,
      outputTokens: tokens.completionTokens,
      cachedInputTokens: tokens.cachedTokens
    });

    const window_ = this.activeWindow;
    const summary = usageService.record({
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: this.currentSessionId,
      inputTokens: tokens.promptTokens,
      outputTokens: tokens.completionTokens,
      cachedInputTokens: tokens.cachedTokens,
      estimatedCost: cost,
      providerId,
      providerName: providerConfig?.name,
      modelId,
      modelName: model?.name,
      projectPath: this.currentProjectPath,
      mode: meta.mode,
      status,
      durationMs: Date.now() - meta.startedAt,
      timestamp: Date.now()
    });

    if (window_) this.send(window_, IPC_CHANNELS.USAGE_EVENT, summary);
    this.emitTokenStats(window_ ?? this.activeWindow, appStore.getSettings().language);

    // Once per run, not once per provider call. This fires while the budget is
    // exceeded, so announcing it every time buried the run's actual work under
    // a column of identical rows and made the timeline unreadable.
    if (window_ && summary.budget.warn && summary.budget.hardStop && summary.budget.exceeded) {
      if (!this.budgetStopAnnounced) {
        this.budgetStopAnnounced = true;
        this.sendEvent(
          window_,
          this.errorItem(
            appStore.getSettings().language === 'th' ? 'งบประมาณถูกใช้เกิน' : 'Budget exceeded',
            appStore.getSettings().language === 'th'
              ? `ค่าใช้จ่ายวันนี้ $${summary.budget.dailySpent.toFixed(4)} / งบ $${summary.budget.daily} — หยุดทำงานอัตโนมัติ`
              : `Today's spend $${summary.budget.dailySpent.toFixed(4)} of $${summary.budget.daily} budget — stopping automatically.`
          )
        );
      }
    } else if (!summary.budget.exceeded) {
      // Back under the limit: a later crossing should be able to speak again.
      this.budgetStopAnnounced = false;
    }
  }

  /**
   * The budget picture, read at most once every few seconds.
   *
   * `usageService.summary` aggregates the usage table, and both the thrift
   * decision and the hard stop need it — asking per provider call would put a
   * query in the hot path for a number that only moves by cents per call.
   */
  private budgetState(): { exceeded: boolean; warn: boolean } {
    const now = Date.now();
    if (!this.budgetCache || now - this.budgetCacheAt > 4000) {
      const budget = usageService.summary(this.currentSessionId).budget;
      this.budgetCache = { exceeded: budget.exceeded, warn: budget.warn };
      this.budgetCacheAt = now;
    }
    return this.budgetCache;
  }

  private budgetBlocks(): boolean {
    if (!appStore.getSettings().budgetHardStop) return false;
    return this.budgetState().exceeded;
  }

  /**
   * Thrift limits, engaged by the user or by the budget itself.
   *
   * Warning alone never saved anyone money: the run kept sending the same
   * oversized prompts until the money was gone, which is exactly the complaint
   * this answers. So once spending passes the warning threshold, the engine
   * switches itself to the cheaper limits for the rest of the run — smaller
   * prompt budget, smaller tool payloads, fewer steps — and says so, instead of
   * reporting the overspend after the fact.
   */
  private thriftLimits(): boolean {
    if (this.thriftActive()) return true;
    if (!appStore.getSettings().autoThriftOnBudget) return false;
    return this.budgetState().warn;
  }

  /** Announces the automatic switch once, with the numbers that caused it. */
  private announceAutoThrift(mainWindow: BrowserWindow, language: 'th' | 'en'): void {
    if (this.thriftActive() || this.autoThriftAnnounced) return;
    if (!appStore.getSettings().autoThriftOnBudget) return;
    if (!this.budgetState().warn) return;
    this.autoThriftAnnounced = true;
    const budget = usageService.summary(this.currentSessionId).budget;
    this.sendEvent(mainWindow, {
      id: `autothrift_${Date.now()}`,
      type: 'thinking',
      title: language === 'th' ? 'โหมดประหยัดโทเคนทำงานอัตโนมัติ' : 'Thrift engaged automatically',
      content:
        language === 'th'
          ? `ค่าใช้จ่ายใกล้งบประมาณ (วันนี้ $${budget.dailySpent.toFixed(2)}/$${budget.daily} · เดือนนี้ $${budget.monthlySpent.toFixed(2)}/$${budget.monthly}) ` +
            `จึงลดขนาดคำขอ ผลลัพธ์เครื่องมือ และจำนวนขั้นลงให้เอง — กลับไปใช้ค่าปกติได้ที่ Settings → การใช้งานและงบประมาณ`
          : `Spending is near the budget (today $${budget.dailySpent.toFixed(2)}/$${budget.daily} · month $${budget.monthlySpent.toFixed(2)}/$${budget.monthly}), ` +
            `so request size, tool output and step count were reduced automatically. Change this in Settings → Usage & budget.`,
      timestamp: Date.now()
    });
  }

  // ------------------------------------------------------------ checkpoints

  /**
   * Snapshot the target file before the agent mutates it so checkpoints can
   * actually be restored (spec §12/§13).
   */
  private snapshotForTool(toolCall: ToolCall): void {
    const settings = appStore.getSettings();
    if (settings.checkpointFrequency === 'off' || settings.checkpointFrequency === 'write') {
      const rawPath: string | undefined = toolCall.args?.path || toolCall.args?.filePath || toolCall.args?.from;
      if (!rawPath) return;
      const full = path.isAbsolute(rawPath) ? rawPath : path.join(this.currentProjectPath, rawPath);
      try {
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return;
        const content = fileService.readFile(full);
        const rel = path.relative(this.currentProjectPath, full).replace(/\\/g, '/');
        appStore.saveCheckpoint({
          id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          description: `${this.currentTaskPrompt.slice(0, 60)} — before ${toolCall.name} ${rel}`,
          files: [{ path: full, content }]
        });
      } catch {
        // A file we cannot read is a file we cannot snapshot; the tool will surface the error.
      }
    }
  }

  // ------------------------------------------------------------------- run

  async run(mainWindow: BrowserWindow, args: AgentRunArgs): Promise<void> {
    const startedAt = Date.now();
    this.onLog('agent', 'info', 'Run started', {
      sessionId: args.sessionId,
      mode: args.mode,
      project: args.projectPath,
      images: args.images?.length ?? 0,
      promptChars: args.prompt?.length ?? 0
    });
    try {
      await this.runInternal(mainWindow, args);
    } catch (error) {
      this.onLog('agent', 'error', 'Run threw', { error: (error as Error)?.message });
      throw error;
    } finally {
      this.onLog(
        'agent',
        this.status === 'failed' ? 'error' : this.status === 'cancelled' ? 'warn' : 'info',
        'Run finished',
        { sessionId: args.sessionId, status: this.status, durationMs: Date.now() - startedAt }
      );
      // Every exit path — completed, failed, cancelled, or a thrown error —
      // leaves a transcript that says the run is over, *and* tells the user what
      // stopped it (spec §84).
      this.emitStopNote(mainWindow, appStore.getSettings().language);
      if (this.transcriptTimer) {
        clearTimeout(this.transcriptTimer);
        this.transcriptTimer = null;
      }
      this.writeTranscript(true);
    }
  }

  private async runInternal(mainWindow: BrowserWindow, args: AgentRunArgs): Promise<void> {
    const { prompt, mode, projectPath, conversationHistory = [] } = args;
    let images = Array.isArray(args.images) ? args.images.slice(0, 6) : [];
    this.cancel();
    this.abortController = new AbortController();
    const token = ++this.runToken;
    this.cancelled = false;
    this.stopReason = 'none';
    this.runTokens = 0;
    this.tokensSaved = 0;
    this.lastPromptTokens = 0;
    this.tokenMeterAnnounced = 0;
    this.autoThriftAnnounced = false;
    this.budgetCache = null;
    this.budgetCacheAt = 0;
    this.lastPermissionMode = null;
    this.pendingApprovals.clear();
    this.sessionApprovals.clear();
    this.currentTaskPrompt = prompt;
    this.currentProjectPath = projectPath;
    this.currentMode = mode;
    this.activeWindow = mainWindow;

    const settings = appStore.getSettings();
    const language = settings.language;
    const startedAt = Date.now();

    // A run either continues the session it was given or starts a fresh one.
    // The stored transcript is always read back: a follow-up prompt in the same
    // session, and a session restored from disk, both need the earlier turns —
    // the client sends no history of its own. Skipping the load when the session
    // id matched the live one used to give every follow-up prompt amnesia (spec §45).
    const sessionId = args.sessionId || `s_${Date.now()}`;
    if (sessionId !== this.currentSessionId) {
      this.runAffectedFiles.clear();
      this.runValidations = [];
    }
    // Start from an empty trail and let a stored transcript replace it. Without
    // the reset a brand new session inherited the previous run's timeline and
    // persisted it under its own id, which silently corrupted resume (spec §45).
    this.sessionTimeline = [];
    this.sessionTodos = [];
    this.sessionPlan = null;
    // A new run starts with a clean ledger: what already happened is per task,
    // never carried across one (§39).
    this.ledger.reset();
    this.contextTrimAnnounced = false;
    const resumedTranscript: SessionTranscript | null = this.loadTranscript(sessionId);
    this.currentSessionId = sessionId;

    // The user's own turn belongs in the transcript too (spec §45): the renderer
    // shows it locally, so it is recorded here without being echoed back. Without
    // it a resumed session replayed the assistant's answers with no questions.
    this.recordTimelineItem({
      id: `u_prompt_${startedAt}`,
      type: 'message',
      title: 'User Prompt',
      content: prompt,
      timestamp: startedAt
    });

    const target = this.resolveTarget(mainWindow, language);
    if ('error' in target) {
      this.onLog('agent', 'warn', 'No usable provider for this run', { error: target.error });
      this.stopReason = 'error';
      this.sendEvent(mainWindow, this.errorItem(language === 'th' ? 'ข้อผิดพลาดผู้ให้บริการ' : 'Provider Error', target.error));
      this.sendStatus(mainWindow, 'failed');
      return;
    }

    const { providerId, modelId, provider } = target;
    this.currentProviderId = providerId;
    this.currentModelId = modelId;

    const existingSession = appStore.getSessions().find((s) => s.id === this.currentSessionId);
    appStore.upsertSession({
      id: this.currentSessionId,
      title: existingSession?.title || prompt.slice(0, 80) || (language === 'th' ? 'เซสชันใหม่' : 'New session'),
      projectPath,
      providerId,
      modelId,
      createdAt: startedAt,
      updatedAt: startedAt,
      status: 'running'
    });

    const projectRules = contextEngine.loadProjectRules(projectPath);
    const mentionedContext = await this.buildMentionContext(prompt, projectPath);

    // Mission is persistent context for this session (spec §40). It goes into
    // every system prompt, so a constraint does not have to be repeated in each
    // request — and it is written back into the transcript for resume.
    const mission = appStore.getMission(sessionId);
    this.sessionMission = mission;
    const missionBlock = mission ? formatMission(mission, language) : '';

    // Attached images only make sense for a model that can see them; refusing
    // them here is clearer than a provider error halfway through the first step.
    if (images.length > 0) {
      const modelInfo = findModel(appStore.getProviders(), providerId, modelId);
      if (!modelInfo?.supportsVision) {
        this.sendEvent(mainWindow, {
          id: `img_warn_${Date.now()}`,
          type: 'error',
          title: language === 'th' ? 'โมเดลนี้ดูรูปไม่ได้' : 'This model cannot see images',
          content:
            language === 'th'
              ? `แนบรูป ${images.length} รูปไว้ แต่ ${modelInfo?.name || modelId} ไม่รองรับภาพ — ส่งเฉพาะข้อความให้โมเดลแทน (เลือกโมเดลที่มีป้ายรูปภาพเพื่อให้โมเดลดูรูปได้)`
              : `You attached ${images.length} image(s), but ${modelInfo?.name || modelId} does not support vision. The request was sent as text only — pick a model with the image badge to have it look at the screenshot.`,
          timestamp: Date.now()
        });
        images = [];
      }
    }

    // Project memory and the chosen screen style, read before the first token is
    // spent: knowing what this project is removes most of the opening
    // exploration, and a chosen style removes the guessing that produced plain
    // pages nobody wanted.
    const memory = appStore.getSettings().projectMemoryEnabled === false
      ? { exists: false, content: '', file: '', updatedAt: null }
      : readProjectMemory(projectPath);
    let design = readProjectDesign(projectPath);
    const memoryBlock = buildMemoryBlock(memory as ProjectMemory, language);
    // A product brief produces a screen even when it never says "UI", so the
    // words that mean "build a thing people look at" count here too.
    const looksLikeUiWork =
      /\b(ui|ux|page|screen|landing|hero|layout|design|style|component|button|form|dashboard|website|web app|app|admin|storefront|saas|navbar|menu|modal|card|theme|font)\b|สี|ดีไซน์|หน้า|ปุ่ม|ฟอร์ม|เมนู|การ์ด|ธีม|ฟอนต์|รูปแบบ|โปรแกรม|แอป|เว็บ|ระบบ|เว็บไซต์/i.test(
        prompt
      );
    // Ask about the style before writing any UI in a project that has not chosen
    // one. The user asked to be asked instead of having a look invented for them,
    // and answered once it is remembered — so this costs one question per project,
    // not one per prompt.
    //
    // The trigger is wider than "the prompt says UI", because the prompts that
    // produce the worst screens name no interface at all — "ทำโปรแกรมอสังหา" is a
    // product brief, and a project that already has screens has a look to keep
    // consistent even when this particular task is a query. A task with no design
    // in it, in a project with no interface, is left alone: that is the case where
    // the question would only be in the way.
    const shouldAskDesign =
      this.currentMode !== 'plan' &&
      design.style === 'ask' &&
      appStore.getSettings().askDesignBeforeUiWork !== false &&
      (looksLikeUiWork || this.projectHasUiSource(projectPath));

    if (shouldAskDesign) {
      const answered = await this.askDesignStyle(mainWindow, projectPath, language);
      if (this.cancelled) return;
      if (answered) design = readProjectDesign(projectPath);
    }

    const designBlock = this.designBlock(design, looksLikeUiWork, language);

    const systemPrompt = `You are D4IDE, an elite autonomous AI software engineering agent.
Operating System: ${process.platform === 'win32' ? 'Windows' : process.platform}
Current Project Path: ${projectPath}
Working directory for all paths: ${projectPath}
User Interface Language: ${language === 'th' ? 'Thai (ไทย)' : 'English'}
${projectRules ? `\nProject Rules & Guidelines:\n${projectRules}\n` : ''}
Instructions:
1. Always analyze before executing file changes.
2. Use tools to read files, search, list directories, and execute terminal commands.
3. Keep file modifications focused and targeted; prefer edit_file over rewriting whole files.
4. If asked in Plan Mode, produce a structured implementation plan with clear steps, affected files, and risk.
5. In Build Mode, follow through and implement the complete task autonomously. Run build or tests when appropriate.
6. Write every message the user reads — including the final summary — in ${language === 'th' ? 'Thai (ไทย)' : 'English'}, whatever language the tool output or earlier messages use. Keep code, identifiers, file paths and quoted command output verbatim.
7. Anything that changes what the user sees is not done until you have looked at it: start the dev server in the background, browser_navigate to the page, browser_screenshot it, read browser_inspect and browser_console, and then judge the screenshot against the design profile — spacing, alignment, hierarchy, contrast, overflow, empty states. Fix what the render reveals and take a second screenshot before reporting. A screen you have not seen renders is not finished, and "it should look good" is not evidence.
10. Check your own work against the design profile like a reviewer would: does every colour, radius, shadow and gap come from the tokens? Is the Thai text free of clipped tone marks, is anything overflowing its box, are focus and hover states visible? Fix these before the user has to point them out.
8. Never run a dev server or watch command in the foreground: call run_terminal with background: true so it keeps running in a terminal while you carry on, and pass its port when you know it. The preview panel opens on the address the server prints — tell the user the address once it is up.
9. ${memoryUpkeepRules(language)}
${memoryBlock}${designBlock}

${tokenDisciplineRules(language)}`;

    // Resume means the model keeps its memory of the session, not just the user
    // seeing the old timeline again (spec §45). A caller-supplied history wins,
    // because only that caller knows what it has already shown the model.
    const replayedFromTranscript = conversationHistory.length === 0;
    const priorConversation = replayedFromTranscript
      ? transcriptToConversation(resumedTranscript)
      : conversationHistory;

    const messages: ChatMessage[] = [
      { id: 'sys', role: 'system', content: `${systemPrompt}${missionBlock}`, timestamp: Date.now() },
      ...priorConversation,
      {
        id: `u_${Date.now()}`,
        role: 'user',
        content: prompt,
        images: images.length > 0 ? images : undefined,
        timestamp: Date.now()
      }
    ];

    // Announce the replay only when it actually happened, so an ordinary
    // follow-up prompt does not report a "resumed" session every time.
    if (resumedTranscript && replayedFromTranscript && priorConversation.length > 0) {
      this.sendEvent(mainWindow, {
        id: `resume_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'กำลังทำงานต่อจากเซสชันเดิม' : 'Continuing the earlier session',
        content:
          language === 'th'
            ? `โหลดเหตุการณ์เดิม ${resumedTranscript.timeline.length} รายการ และส่งบทสนทนาก่อนหน้า ${priorConversation.length} ข้อความให้โมเดล`
            : `Loaded ${resumedTranscript.timeline.length} recorded events and replayed ${priorConversation.length} earlier message(s) to the model.`,
        timestamp: Date.now()
      });
    }

    if (mentionedContext.length > 0) {
      messages.push({
        id: `ctx_${Date.now()}`,
        role: 'user',
        content: `Referenced context from @mentions:\n\n${mentionedContext
          .map((c) => `--- ${c.name} ---\n${c.content}`)
          .join('\n\n')}`,
        timestamp: Date.now()
      });
    }

    // Shared with subagents, so their edits are verified and reported too.
    const affectedFilesList = this.runAffectedFiles;
    const touchedFiles = new Set<string>();

    // How far the user let an approved plan run. Set inside plan mode; the build
    // loop reads it to decide where to stop and ask again (spec §35).
    let planScope: PlanScope = 'full';

    // --- PLAN MODE ---
    if (mode === 'plan') {
      this.sendStatus(mainWindow, 'planning');
      this.sendEvent(mainWindow, {
        id: `plan_start_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'กำลังวิเคราะห์โปรเจกต์และวางแผน...' : 'Analyzing project & formulating plan...',
        timestamp: Date.now()
      });

      messages.push({
        id: `p_${Date.now()}`,
        role: 'user',
        content: `Please inspect the codebase if needed and formulate a clear Implementation Plan for: "${prompt}".
Provide:
1. Steps to implement
2. Affected files
3. Estimated scope
4. Risk assessment (Low, Medium, High)
Return your plan in structured markdown.`,
        timestamp: Date.now()
      });

      // A plan can come back for revision, so the card is shown in a loop: the
      // user either approves it (with a scope), sends it back with notes, or
      // cancels the task outright.
      let approvedPlanText = '';
      for (;;) {
        let planAccumulated = '';
        try {
          // The inspection loop runs read-only tools, then produces the plan text.
          planAccumulated = await this.planToolLoop(mainWindow, provider, projectPath, messages, token);
        } catch (err: any) {
          if (this.isCancelled(token)) {
            this.sendStatus(mainWindow, 'cancelled');
            return;
          }
          this.stopReason = 'error';
          this.sendEvent(
            mainWindow,
            this.errorItem(
              language === 'th' ? 'ข้อผิดพลาดการวางแผน' : 'Planning Error',
              this.describeFailure(providerManager.getConfig(providerId)?.name ?? providerId, err, language)
            )
          );
          this.sendStatus(mainWindow, 'failed');
          return;
        }

        const planData: PlanData = {
          summary: planAccumulated,
          steps: planAccumulated
            .split('\n')
            .filter((l) => /^\d+\./.test(l.trim()))
            .map((l) => l.trim()),
          affectedFiles: [],
          estimatedScope: 'Medium',
          risk: 'Medium',
          approved: false
        };

        this.currentPlan = planData;
        this.sessionPlan = planData;
        this.sendEvent(mainWindow, {
          id: `plan_card_${Date.now()}`,
          type: 'plan',
          title: language === 'th' ? 'แผนการทำงาน (Implementation Plan)' : 'Implementation Plan',
          content: planAccumulated,
          details: { ...planData, language },
          timestamp: Date.now()
        });

        this.sendStatus(mainWindow, 'waiting_approval');

        const decision = await new Promise<PlanDecision>((resolve) => {
          this.pendingPlanResolver = resolve;
        });

        if (decision.action === 'revise') {
          const feedback = (decision.feedback || '').trim();
          messages.push({
            id: `plan_rev_${Date.now()}`,
            role: 'user',
            content: `The plan is not approved yet — revise it before writing any code.\nUser feedback: ${
              feedback || '(no detail given — make the plan more concrete and smaller in scope)'
            }\n\nReturn the complete updated plan in the same structured markdown.`,
            timestamp: Date.now()
          });
          this.sendEvent(mainWindow, {
            id: `plan_rev_ev_${Date.now()}`,
            type: 'thinking',
            title: language === 'th' ? 'แก้ไขแผนตามความเห็นของคุณ' : 'Revising the plan',
            content: feedback || undefined,
            timestamp: Date.now()
          });
          continue;
        }

        if (decision.action !== 'approve' || !decision.scope) {
          appStore.upsertSession({
            id: this.currentSessionId,
            title: existingSession?.title || prompt.slice(0, 80),
            projectPath,
            providerId,
            modelId,
            createdAt: startedAt,
            updatedAt: Date.now(),
            status: 'cancelled'
          });
          this.sendStatus(mainWindow, 'cancelled');
          this.sendEvent(
            mainWindow,
            {
              id: `plan_rej_${Date.now()}`,
              type: 'message',
              title: language === 'th' ? 'แผนถูกยกเลิกโดยผู้ใช้' : 'Plan cancelled by user',
              timestamp: Date.now()
            }
          );
          return;
        }

        planScope = decision.scope;
        approvedPlanText = planAccumulated;
        planData.approved = true;
        planData.scope = planScope;
        this.currentPlan = planData;
        this.sessionPlan = planData;
        break;
      }

      this.currentMode = 'build';
      messages.push({
        id: `plan_app_${Date.now()}`,
        role: 'user',
        content: this.planApprovalMessage(approvedPlanText, planScope),
        timestamp: Date.now()
      });
    }

    // --- BUILD MODE LOOP ---
    this.sendStatus(mainWindow, 'running');
    let stepCount = 0;
    // Cheaper mode means fewer steps, not just a politer prompt.
    const maxSteps = this.thriftLimits()
      ? Math.min(settings.maxAgentSteps || 30, 12)
      : settings.maxAgentSteps || 30;
    let finished = false;
    // Automatic thrift is announced on the timeline once, with the figures that
    // triggered it, so a quietly cheaper run is not a mystery.
    this.announceAutoThrift(mainWindow, language);

    const liveTodos: AgentTodo[] = [
      { id: '1', text: language === 'th' ? 'วิเคราะห์ความต้องการ' : 'Analyze requirement', status: 'completed' },
      { id: '2', text: language === 'th' ? 'ดำเนินการแก้ไขโค้ด' : 'Implement changes', status: 'in_progress' },
      { id: '3', text: language === 'th' ? 'ตรวจสอบและรันการทดสอบ' : 'Verify & test', status: 'pending' },
      { id: '4', text: language === 'th' ? 'สรุปผลการทำงาน' : 'Finalize summary', status: 'pending' }
    ];
    this.sendTodos(mainWindow, liveTodos);

    const maxVerificationRounds = 2;
    let verificationWarning: string | null = null;

    for (let round = 0; round <= maxVerificationRounds; round++) {
      // Each round is a full agent loop; a failed verification starts another
      // one so the model can fix what the build or tests reported.
      finished = false;

      while (!finished && stepCount < maxSteps) {
      if (this.isCancelled(token)) {
        this.sendStatus(mainWindow, 'cancelled');
        return;
      }

      if (this.budgetBlocks()) {
        // A budget stop used to be a silent `failed`: the run just vanished with
        // no message, which reads exactly like "I approved everything and nothing
        // happened". Say what stopped it and how to continue.
        this.stopReason = 'budget';
        this.sendEvent(mainWindow, this.budgetStopItem(language));
        this.sendStatus(mainWindow, 'failed');
        return;
      }

      // A ceiling the user can see and predict. Without it, "cheap mode" was a
      // promise: the run could spend as much as it liked and only the daily
      // total ever pushed back.
      const tokenCap = this.runTokenCap();
      if (tokenCap > 0 && this.runTokens >= tokenCap) {
        this.sendEvent(mainWindow, {
          id: `tokencap_${Date.now()}`,
          type: 'error',
          title: language === 'th' ? 'ถึงงบโทเคนของงานนี้' : 'Run token budget reached',
          content:
            language === 'th'
              ? `งานนี้ใช้ไปประมาณ ${this.runTokens.toLocaleString()} โทเคน (งบ ${tokenCap.toLocaleString()}) จึงหยุดตรงนี้ ` +
                'เพื่อไม่ให้บิลบานปลาย ไฟล์ที่แก้แล้วยังอยู่ครบ — ส่งข้อความ "ทำต่อจากที่ค้างอยู่" เพื่อไปต่อ หรือเพิ่มงบที่ การตั้งค่า → การใช้งานและงบประมาณ'
              : `This run spent about ${this.runTokens.toLocaleString()} tokens (budget ${tokenCap.toLocaleString()}), so it stopped here ` +
                'rather than run the bill up. Files already changed are kept — send "continue where you left off" to carry on, or raise the budget in Settings → Usage & Budget.',
          timestamp: Date.now()
        });
        this.stopReason = 'budget';
        this.sendStatus(mainWindow, 'failed');
        return;
      }

      stepCount++;
      let assistantText = '';
      let reasoningText = '';
      let pendingToolCalls: ToolCall[] = [];
      const stepStartedAt = Date.now();

      try {
        await this.runProviderCall(
          mainWindow,
          provider,
          providerId,
          modelId,
          {
            model: modelId,
            messages,
            tools: toolRegistry.getToolDefinitions('build'),
            reasoningEffort: settings.reasoningEffort,
            // Same id for every request in this conversation: Go/Zen route and
            // cache per session, and a fresh id per turn would defeat both.
          sessionId: this.currentSessionId,
            signal: this.abortController.signal
          },
          (chunk) => {
            if (chunk.content) assistantText += chunk.content;
            if (chunk.reasoningContent) reasoningText += chunk.reasoningContent;
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              pendingToolCalls = [...pendingToolCalls, ...chunk.toolCalls];
            }
          },
          { mode: 'build', startedAt: stepStartedAt, label: `step ${stepCount}`, token }
        );

        if (reasoningText.trim()) {
          this.sendEvent(mainWindow, {
            id: `reason_${Date.now()}_${stepCount}`,
            type: 'thinking',
            title: language === 'th' ? 'การคิดวิเคราะห์' : 'Reasoning',
            content: reasoningText.length > 2000 ? `${reasoningText.slice(0, 2000)}…` : reasoningText,
            timestamp: Date.now()
          });
        }

        if (assistantText.trim()) {
          this.sendEvent(mainWindow, {
            id: `msg_${Date.now()}_${stepCount}`,
            type: 'message',
            title: 'D4 Agent',
            content: assistantText,
            timestamp: Date.now()
          });

          // Saying the same thing three turns running is a loop that costs the
          // same as any other: name it and ask for the remaining work (§39).
          if (this.ledger.isRepeatingText(assistantText)) {
            const notice = repetitionNotice(language);
            this.sendEvent(mainWindow, {
              id: `repeat_${Date.now()}_${stepCount}`,
              type: 'thinking',
              title: language === 'th' ? 'ตรวจพบการพูดซ้ำ' : 'Repeated answer detected',
              content: notice,
              timestamp: Date.now()
            });
            messages.push({
              id: `repeat_nudge_${Date.now()}`,
              role: 'user',
              content: notice,
              timestamp: Date.now()
            });
          }
        }

        if (pendingToolCalls.length === 0) {
          finished = true;
          break;
        }

        messages.push({
          id: `asst_${Date.now()}_${stepCount}`,
          role: 'assistant',
          content: assistantText,
          toolCalls: pendingToolCalls,
          timestamp: Date.now()
        });

        for (const tc of pendingToolCalls) {
          if (this.isCancelled(token)) {
            this.sendStatus(mainWindow, 'cancelled');
            return;
          }

          const mode = this.livePermissionMode(mainWindow, language);
          const perm = permissionEngine.check(mode, tc);
          const toolStartedAt = Date.now();

          if (!perm.allowed) {
            this.sendEvent(mainWindow, this.errorItem('Permission Blocked', perm.reason || 'Blocked by security guardrails'));
            appStore.appendToolAudit({
              id: `a_${Date.now()}`,
            sessionId: this.currentSessionId,
              toolName: tc.name,
              argsPreview: JSON.stringify(tc.args).slice(0, 300),
              mode: this.livePermissionMode(),
              allowed: false,
              requiresApproval: perm.requiresApproval,
              decision: 'rejected',
              reason: perm.reason,
              timestamp: Date.now()
            });
            messages.push({
              id: `tool_block_${Date.now()}`,
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: `Error: Execution denied by security guardrail: ${perm.reason}`,
              timestamp: Date.now()
            });
            continue;
          }

          // Approval gate (spec §14): Safe/Ask must not write silently.
          let decision: 'auto' | 'approved' | 'approved_for_session' | 'rejected' = 'auto';
          if (perm.requiresApproval && mode !== 'full') {
            if (this.sessionApprovals.has(tc.name)) {
              decision = 'approved_for_session';
            } else {
              decision = await this.requestApproval(mainWindow, tc, mode, perm.reason);
              // The task is running again whichever way the user decided.
              this.sendStatus(mainWindow, 'running');
              if (decision === 'rejected') {
                appStore.appendToolAudit({
                  id: `a_${Date.now()}`,
                sessionId: this.currentSessionId,
                  toolName: tc.name,
                  argsPreview: JSON.stringify(tc.args).slice(0, 300),
                  mode: this.livePermissionMode(),
                  allowed: true,
                  requiresApproval: true,
                  decision: 'rejected',
                  reason: 'User rejected the action',
                  timestamp: Date.now()
                });

                // Surface the refusal in the timeline, not only in the audit log.
                this.sendEvent(mainWindow, {
                  id: `tr_${tc.id}`,
                  type: 'tool_result',
                  title: `${tc.name} Result`,
                  content: language === 'th' ? 'ผู้ใช้ไม่อนุญาตให้ดำเนินการนี้' : 'User rejected this action.',
                  toolResult: { toolCallId: tc.id, success: false, error: 'User rejected this action.' },
                  status: 'failed',
                  timestamp: Date.now()
                });

                messages.push({
                  id: `tool_deny_${Date.now()}`,
                  role: 'tool',
                  toolCallId: tc.id,
                  name: tc.name,
                  content: 'User rejected this action. Ask for an alternative approach or stop.',
                  timestamp: Date.now()
                });
                continue;
              }
            }
          }

          // Token discipline (spec §39): the same call twice is answered from
          // memory, and a call that keeps coming back is refused — both cheaper
          // than paying for another identical round trip.
          const verdict = this.ledger.inspect(tc);
          if (verdict.action === 'reuse') {
            const cached = verdict.cached ?? '';
            this.sendEvent(mainWindow, {
              id: `tc_${tc.id}`,
              type: 'tool_call',
              title: tc.name,
              content: JSON.stringify(tc.args, null, 2),
              toolCall: tc,
              status: 'success',
              timestamp: Date.now()
            });
            this.sendEvent(mainWindow, {
              id: `tr_${tc.id}`,
              type: 'tool_result',
              title: language === 'th' ? `${tc.name} (ใช้ผลเดิม)` : `${tc.name} (reused)`,
              content: cached,
              toolResult: { toolCallId: tc.id, success: true, output: cached },
              status: 'success',
              details: { reused: true, count: verdict.count },
              timestamp: Date.now()
            });
            messages.push({
              id: `tc_reuse_${Date.now()}_${tc.id}`,
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: `${cached}\n\n[${reuseNotice(language, verdict.count)}]`,
              timestamp: Date.now()
            });
            continue;
          }

          if (verdict.action === 'blocked') {
            const notice = loopNotice(language, tc, verdict.count);
            this.sendEvent(
              mainWindow,
              this.errorItem(language === 'th' ? 'หยุดการวนซ้ำ' : 'Stopped a repeated call', notice)
            );
            messages.push({
              id: `tc_block_${Date.now()}_${tc.id}`,
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: notice,
              timestamp: Date.now()
            });
            continue;
          }

          const eventId = `tc_${tc.id}`;
          this.sendEvent(mainWindow, {
            id: eventId,
            type: 'tool_call',
            title: tc.name,
            content: JSON.stringify(tc.args, null, 2),
            toolCall: tc,
            status: 'running',
            timestamp: Date.now()
          });

          if (WRITE_TOOLS.has(tc.name)) {
            this.snapshotForTool(tc);
            const rel = (tc.args?.path || tc.args?.filePath) as string | undefined;
            if (rel) touchedFiles.add(rel);
          }

          const result = await this.executeTool(tc, projectPath, (change) => {
            affectedFilesList.add(change.relativePath);
            touchedFiles.add(change.relativePath);
            this.sendFileChange(mainWindow, change);
          });

          appStore.appendToolAudit({
            id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sessionId: this.currentSessionId,
            toolName: tc.name,
            argsPreview: JSON.stringify(tc.args).slice(0, 300),
            mode: this.livePermissionMode(),
            allowed: true,
            requiresApproval: perm.requiresApproval,
            decision,
            reason: perm.reason,
            durationMs: Date.now() - toolStartedAt,
            timestamp: Date.now()
          });

          this.sendEvent(mainWindow, {
            id: `tr_${tc.id}`,
            type: 'tool_result',
            title: `${tc.name} Result`,
            content: result.success
              ? typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output, null, 2)
              : `Error: ${result.error}`,
            toolResult: result,
            imagePath: this.screenshotPathFor(tc, result),
            status: result.success ? 'success' : 'failed',
            timestamp: Date.now()
          });

          messages.push({
            id: `tr_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: result.success
              ? typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output)
              : `Tool Error: ${result.error}`,
            timestamp: Date.now()
          });

          // Remember read-only results so the next identical call is free.
          if (result.success) {
            this.ledger.remember(
              tc,
              typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
            );
          }

          liveTodos[1].status = 'in_progress';
          this.sendTodos(mainWindow, liveTodos);
        }
      } catch (err: any) {
        if (this.isCancelled(token)) {
          this.sendStatus(mainWindow, 'cancelled');
          return;
        }
        this.stopReason = 'error';
        this.sendEvent(
          mainWindow,
          this.errorItem(
            language === 'th' ? 'ข้อผิดพลาดการทำงาน' : 'Execution Error',
            this.describeFailure(providerManager.getConfig(providerId)?.name ?? providerId, err, language)
          )
        );
        this.sendStatus(mainWindow, 'failed');
        return;
      }

      // Scope gate (spec §35). Approving step-by-step means the run stops here,
      // at a completed step, and waits — so "continue" is always a decision the
      // user makes after seeing what the last step actually did.
      if (planScope !== 'full' && (planScope === 'step' || stepCount === 1)) {
        const gate = await this.awaitPlanStepGate(mainWindow, language, stepCount);
        if (gate === 'stop') {
          this.sendEvent(mainWindow, {
            id: `step_stop_${Date.now()}`,
            type: 'message',
            title: language === 'th' ? 'หยุดตามที่คุณสั่ง' : 'Stopped at your request',
            content:
              language === 'th'
                ? `ทำงานถึงขั้นตอนที่ ${stepCount} แล้ว และยังไม่เริ่มขั้นตอนถัดไป`
                : `Worked through step ${stepCount}; the next step was not started.`,
            timestamp: Date.now()
          });
          this.sendStatus(mainWindow, 'paused');
          return;
        }
        if (gate === 'runAll') planScope = 'full';
        else if (planScope === 'first') planScope = 'step';
      }
    }

      if (this.isCancelled(token)) {
        this.sendStatus(mainWindow, 'cancelled');
        return;
      }

      // Verification pass (spec §2, §75): after the agent changed files, run the
      // project's own build/tests and hand any failure back for the model to fix.
      const verdict = await this.verifyChanges(mainWindow, projectPath, affectedFilesList, settings, language);
      if (!verdict.failed) {
        verificationWarning = null;
        break;
      }
      if (round === maxVerificationRounds) {
        verificationWarning = verdict.output;
        break;
      }

      this.sendEvent(mainWindow, {
        id: `verify_retry_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'การตรวจสอบไม่ผ่าน — กำลังแก้ไข' : 'Verification failed — fixing',
        content: verdict.output.slice(0, 2000),
        timestamp: Date.now()
      });

      messages.push({
        id: `verify_${Date.now()}`,
        role: 'user',
        content: `Automated verification of your changes failed. Fix the root cause, then finish.\n\n${verdict.output.slice(0, 12000)}`,
        timestamp: Date.now()
      });
    }

    // Running out of steps is not the same as finishing, and it used to look
    // identical: the run ended with a normal completion summary at the step
    // ceiling, so a task that stopped half-done read as "done, nothing to show".
    if (!finished) {
      this.sendEvent(
        mainWindow,
        this.errorItem(
          language === 'th' ? 'ถึงขีดจำกัดจำนวนขั้นตอน' : 'Step ceiling reached',
          language === 'th'
            ? `งานนี้ใช้ครบ ${maxSteps} ขั้นตอนที่ตั้งไว้ (Settings → การทำงานของ Agent) งานอาจยังไม่จบครบ — ` +
              'เพิ่มจำนวนขั้นสูงสุดหรือส่งข้อความ "ทำต่อจากที่ค้างอยู่" เพื่อไปต่อ ไฟล์ที่แก้แล้วยังอยู่ครบ'
            : `The run used all ${maxSteps} steps allowed (Settings → Agent behaviour), so it may be unfinished — ` +
              'raise the ceiling or send "continue where you left off" to keep going. Files already changed are kept.'
        )
      );
    }

    liveTodos[1].status = 'completed';
    liveTodos[2].status = 'completed';
    liveTodos[3].status = 'completed';
    this.sendTodos(mainWindow, liveTodos);

    if (verificationWarning) {
      this.sendEvent(
        mainWindow,
        this.errorItem(
          language === 'th' ? 'การตรวจสอบยังไม่ผ่าน' : 'Verification still failing',
          verificationWarning.slice(0, 2000)
        )
      );
    }

    const sessionUsage = usageService.summary(this.currentSessionId).session;

    // Spec §88 asks for the validation that actually ran, not a claim that
    // everything passed — a failed build is reported here as a failure.
    const summaryText = buildCompletionSummary({
      language,
      changedFiles: Array.from(affectedFilesList),
      validations: this.runValidations,
      usage: sessionUsage
    });

    this.stopReason = 'completed';
    this.sendEvent(mainWindow, {
      id: `summary_${Date.now()}`,
      type: 'summary',
      title: language === 'th' ? 'สรุปผลการทำงาน (Summary)' : 'Completion Summary',
      content: summaryText,
      timestamp: Date.now()
    });

    appStore.upsertSession({
      id: this.currentSessionId,
      title: appStore.getSessions().find((s) => s.id === this.currentSessionId)?.title || prompt.slice(0, 80),
      projectPath,
      providerId,
      modelId,
      createdAt: startedAt,
      updatedAt: Date.now(),
      status: 'completed'
    });

    this.sendStatus(mainWindow, 'completed');
  }

  /**
   * Runs the project's build and/or tests after files changed, streaming the
   * results into the timeline and auditing them like any other tool call.
   */
  private async verifyChanges(
    mainWindow: BrowserWindow,
    projectPath: string,
    affectedFiles: Set<string>,
    settings: AppSettings,
    language: 'th' | 'en'
  ): Promise<{ failed: boolean; output: string }> {
    if (affectedFiles.size === 0) return { failed: false, output: '' };

    const steps: { tool: 'run_build' | 'run_tests'; command: string }[] = [];
    if (settings.autoRunBuild && hasPackageScript(projectPath, 'build')) {
      steps.push({ tool: 'run_build', command: detectScriptCommand(projectPath, 'build') });
    }
    if (settings.autoRunTests && hasPackageScript(projectPath, 'test')) {
      steps.push({ tool: 'run_tests', command: detectScriptCommand(projectPath, 'test') });
    }
    if (steps.length === 0) return { failed: false, output: '' };

    let output = '';
    let failed = false;

    for (const step of steps) {
      const callId = `verify_${step.tool}_${Date.now()}`;
      this.sendEvent(mainWindow, {
        id: `tc_${callId}`,
        type: 'tool_call',
        title: step.tool,
        content: JSON.stringify({ command: step.command }, null, 2),
        toolCall: { id: callId, name: step.tool, args: { command: step.command } },
        status: 'running',
        timestamp: Date.now()
      });

      const started = Date.now();
      const run = await toolRegistry.execute({ id: callId, name: step.tool, args: { command: step.command } }, projectPath);
      const ok = run.success && (run.output as any)?.exitCode === 0;
      const raw = run.success
        ? `${(run.output as any)?.stdout ?? ''}\n${(run.output as any)?.stderr ?? ''}`.trim()
        : run.error || 'Command failed to run';
      const tail = raw.slice(-6000);

      this.sendEvent(mainWindow, {
        id: `tr_${callId}`,
        type: 'tool_result',
        title: `${step.tool} Result`,
        content: tail || (ok ? 'Command finished with no output.' : 'Command failed with no output.'),
        toolResult: run,
        status: ok ? 'success' : 'failed',
        timestamp: Date.now()
      });

      appStore.appendToolAudit({
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId: this.currentSessionId,
        toolName: step.tool,
        argsPreview: step.command,
        mode: this.livePermissionMode(),
        allowed: true,
        requiresApproval: false,
        decision: 'auto',
        reason: language === 'th' ? 'ตรวจสอบอัตโนมัติหลังแก้ไฟล์' : 'Automatic verification after edits',
        durationMs: Date.now() - started,
        timestamp: Date.now()
      });

      this.runValidations.push({ command: step.command, ok });
      output += `$ ${step.command}\n${tail || '(no output)'}\n\n`;
      if (!ok) {
        failed = true;
        break;
      }
    }

    return { failed, output };
  }

  // -------------------------------------------------------------- subagents

  /** Tool-registry entry point for delegation (spec §81). */
  private async runSubagentTool(
    args: { role: string; task: string },
    projectPath: string
  ): Promise<{ role: string; report: string; steps: number; files: string[] }> {
    const definition = getSubagent(args.role);
    if (!definition) {
      throw new Error(
        `Unknown subagent role "${args.role}". Valid roles: ${SUBAGENTS.map((entry) => entry.role).join(', ')}.`
      );
    }
    if (!String(args.task || '').trim()) throw new Error('spawn_subagent requires a task.');
    if (this.subagentDepth > 0) {
      throw new Error('Subagents cannot delegate further — do this work yourself.');
    }
    // Plan Mode promises the user that nothing is written until the plan is
    // approved. A write-capable subagent would silently break that promise,
    // because it is handed the build tool set regardless of the parent mode.
    if (this.currentMode === 'plan' && definition.writeCapable) {
      throw new Error(
        `The "${args.role}" subagent can modify files, which Plan Mode forbids. Use a read-only role ` +
          '(explore, review, test, debug) to gather information, present the plan, and delegate to ' +
          `"${args.role}" once the plan is approved.`
      );
    }
    return this.runSubagent(definition, String(args.task).trim(), projectPath);
  }

  /**
   * Runs one subagent to completion and returns its report. The subagent gets a
   * fresh message history (that is the point of delegation), the same budget and
   * abort signal as the parent, and a *restricted* tool set: read-only roles are
   * handed the non-mutating tools, so a reviewer cannot quietly rewrite the code
   * it is reviewing.
   */
  private async runSubagent(
    definition: SubagentDefinition,
    task: string,
    projectPath: string
  ): Promise<{ role: string; report: string; steps: number; files: string[] }> {
    const mainWindow = this.activeWindow;
    if (!mainWindow) throw new Error('No active window for the subagent.');

    const settings = appStore.getSettings();
    const language = settings.language;

    // A read-only subagent reads files and reports — the cheapest useful model
    // can do that, and it runs several times per delegation. A write-capable one
    // keeps the model the user chose: quality of the code matters more than the
    // saving. When no cheap model is configured, nothing changes.
    const cheap = settings.cheaperModelForSmallTasks && !definition.writeCapable ? this.cheapModel() : null;
    const subagentProviderId = cheap?.providerId ?? this.currentProviderId;
    const subagentModelId = cheap?.modelId ?? this.currentModelId;
    const provider = providerManager.getProvider(subagentProviderId);
    if (!provider) throw new Error('The provider for this run is no longer available — start the task again.');
    if (cheap) {
      this.sendEvent(mainWindow, {
        id: `sub_cheap_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'ใช้โมเดลประหยัดกับงานยิบย่อย' : 'Using the cheap model for a small job',
        content:
          language === 'th'
            ? `${definition.label} เป็นงานอ่านอย่างเดียว จึงใช้ ${subagentProviderId}/${subagentModelId} แทน เพื่อลดค่าใช้จ่าย`
            : `${definition.label} only reads and reports, so it ran on ${subagentProviderId}/${subagentModelId} instead of the main model.`,
        timestamp: Date.now()
      });
    }

    const role = definition.role as SubagentRole;
    const tools = toolRegistry
      .getToolDefinitions(definition.writeCapable ? 'build' : 'plan')
      .filter((tool) => tool.name !== 'spawn_subagent');

    const startedAt = Date.now();
    this.sendEvent(mainWindow, {
      id: `sub_start_${Date.now()}`,
      type: 'subagent',
      title: definition.label,
      content: task,
      agent: role,
      status: 'running',
      timestamp: startedAt,
      details: { role, task, writeCapable: definition.writeCapable }
    });

    const files = new Set<string>();
    const messages: ChatMessage[] = [
      {
        id: `sub_sys_${Date.now()}`,
        role: 'system',
        content: buildSubagentSystemPrompt(definition, {
          projectPath,
          language,
          parentTask: this.currentTaskPrompt
        }),
        timestamp: startedAt
      },
      { id: `sub_user_${Date.now()}`, role: 'user', content: task, timestamp: startedAt }
    ];

    const maxSteps = Math.max(2, Math.min(definition.maxSteps, settings.maxAgentSteps || definition.maxSteps));
    let report = '';
    let steps = 0;

    this.subagentDepth++;
    try {
      while (steps < maxSteps) {
        if (this.isCancelled()) throw new Error('Cancelled.');
        if (this.budgetBlocks()) throw new Error('The usage budget for this period is exhausted.');

        steps++;
        let text = '';
        let toolCalls: ToolCall[] = [];

        await this.runProviderCall(
          mainWindow,
          provider,
          subagentProviderId,
          subagentModelId,
          {
            model: subagentModelId,
            messages,
            tools,
            reasoningEffort: subagentModelId === this.currentModelId ? settings.reasoningEffort : 'low',
            // Same id for every request in this conversation: Go/Zen route and
            // cache per session, and a fresh id per turn would defeat both.
            sessionId: this.currentSessionId,
            signal: this.abortController?.signal
          },
          (chunk) => {
            if (chunk.content) text += chunk.content;
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              toolCalls = [...toolCalls, ...chunk.toolCalls];
            }
          },
          // The subagent runs inside the parent's loop, so it wears the parent's
          // token: a stop pressed in the UI stops the delegated work too.
          { mode: this.currentMode, startedAt: Date.now(), label: `subagent:${role} step ${steps}`, token: this.runToken }
        );

        if (text.trim()) report = text.trim();
        if (toolCalls.length === 0) break;

        messages.push({
          id: `sub_asst_${Date.now()}_${steps}`,
          role: 'assistant',
          content: text,
          toolCalls,
          timestamp: Date.now()
        });

        for (const toolCall of toolCalls) {
          if (this.isCancelled()) throw new Error('Cancelled.');
          const output = await this.runSubagentToolCall(mainWindow, toolCall, definition, projectPath, settings);
          messages.push({
            id: `sub_res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: output.slice(0, 12000),
            timestamp: Date.now()
          });
          const changed = toolCall.args?.path || toolCall.args?.filePath;
          if (changed && typeof changed === 'string') files.add(changed);
        }
      }
    } finally {
      this.subagentDepth--;
    }

    const summary = report || (language === 'th' ? '(ผู้ช่วยย่อยไม่ได้สรุปผล)' : '(the subagent produced no report)');
    this.sendEvent(mainWindow, {
      id: `sub_done_${Date.now()}`,
      type: 'subagent',
      title: definition.label,
      content: summary,
      agent: role,
      status: 'success',
      timestamp: Date.now(),
      details: { role, report: summary, steps, files: Array.from(files) }
    });

    return { role, report: summary.slice(0, 8000), steps, files: Array.from(files) };
  }

  /**
   * Executes one tool call on behalf of a subagent. Kept separate from the main
   * loop so the security gate, the audit trail and the timeline treatment stay
   * identical no matter who asked for the tool.
   */
  private async runSubagentToolCall(
    mainWindow: BrowserWindow,
    toolCall: ToolCall,
    definition: SubagentDefinition,
    projectPath: string,
    settings: AppSettings
  ): Promise<string> {
    const role = definition.role as SubagentRole;
    const toolStartedAt = Date.now();
    const perm = permissionEngine.check(this.livePermissionMode(), toolCall);

    if (!perm.allowed) {
      this.sendEvent(mainWindow, {
        id: `sub_block_${toolCall.id}`,
        type: 'error',
        title: `${definition.label} · Permission Blocked`,
        content: perm.reason || 'Blocked by security guardrails',
        agent: role,
        timestamp: Date.now()
      });
      appStore.appendToolAudit({
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId: this.currentSessionId,
        toolName: toolCall.name,
        argsPreview: JSON.stringify(toolCall.args).slice(0, 300),
        mode: this.livePermissionMode(),
        allowed: false,
        requiresApproval: perm.requiresApproval,
        decision: 'rejected',
        reason: `${perm.reason ?? ''} [via ${role} subagent]`.trim(),
        timestamp: Date.now()
      });
      return `Error: denied by security guardrails: ${perm.reason}`;
    }

    let decision: 'auto' | 'approved' | 'approved_for_session' | 'rejected' = 'auto';
    if (perm.requiresApproval && this.livePermissionMode() !== 'full') {
      if (this.sessionApprovals.has(toolCall.name)) {
        decision = 'approved_for_session';
      } else {
        decision = await this.requestApproval(
          mainWindow,
          toolCall,
          this.livePermissionMode(),
          `${perm.reason ?? ''} (${definition.label} subagent)`.trim()
        );
        this.sendStatus(mainWindow, 'running');
        if (decision === 'rejected') {
          this.sendEvent(mainWindow, {
            id: `sub_deny_${toolCall.id}`,
            type: 'tool_result',
            title: `${toolCall.name} Result`,
            content: settings.language === 'th' ? 'ผู้ใช้ไม่อนุญาตให้ดำเนินการนี้' : 'User rejected this action.',
            toolResult: { toolCallId: toolCall.id, success: false, error: 'User rejected this action.' },
            agent: role,
            status: 'failed',
            timestamp: Date.now()
          });
          return 'User rejected this action. Ask for an alternative approach or stop.';
        }
      }
    }

    this.sendEvent(mainWindow, {
      id: `sub_tc_${toolCall.id}`,
      type: 'tool_call',
      title: toolCall.name,
      content: JSON.stringify(toolCall.args, null, 2),
      toolCall,
      agent: role,
      status: 'running',
      timestamp: Date.now()
    });

    if (WRITE_TOOLS.has(toolCall.name)) this.snapshotForTool(toolCall);

    const result = await this.executeTool(toolCall, projectPath, (change) => {
      this.runAffectedFiles.add(change.relativePath);
      this.sendFileChange(mainWindow, change);
    });

    appStore.appendToolAudit({
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: this.currentSessionId,
      toolName: toolCall.name,
      argsPreview: JSON.stringify(toolCall.args).slice(0, 300),
      mode: this.livePermissionMode(),
      allowed: true,
      requiresApproval: perm.requiresApproval,
      decision,
      reason: `${perm.reason ?? ''} [via ${role} subagent]`.trim(),
      durationMs: Date.now() - toolStartedAt,
      timestamp: Date.now()
    });

    this.sendEvent(mainWindow, {
      id: `sub_tr_${toolCall.id}`,
      type: 'tool_result',
      title: `${toolCall.name} Result`,
      content: result.success
        ? typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output, null, 2)
        : `Error: ${result.error}`,
      toolResult: result,
      agent: role,
      imagePath: this.screenshotPathFor(toolCall, result),
      status: result.success ? 'success' : 'failed',
      timestamp: Date.now()
    });

    return result.success
      ? typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output)
      : `Tool Error: ${result.error}`;
  }

  /** Browser screenshots are surfaced in the UI, not just written to disk. */
  private screenshotPathFor(toolCall: ToolCall, result: ToolResult): string | undefined {
    if (!result.success || toolCall.name !== 'browser_screenshot') return undefined;
    const relative = result.output?.relativePath;
    return typeof relative === 'string' ? relative : undefined;
  }

  private async executeTool(
    toolCall: ToolCall,
    projectPath: string,
    onFileChange: (change: FileChange) => void
  ): Promise<ToolResult> {
    const timeoutMs = appStore.getSettings().toolTimeoutMs || 120000;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Tool "${toolCall.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([toolRegistry.execute(toolCall, projectPath, onFileChange), timeout]);
    } catch (e: any) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: e?.message || 'Tool execution failed'
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private requestApproval(
    mainWindow: BrowserWindow,
    toolCall: ToolCall,
    mode: 'safe' | 'ask' | 'full',
    reason?: string
  ): Promise<'approved' | 'approved_for_session' | 'rejected'> {
    const id = `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      const request: ApprovalRequest = {
        id,
        sessionId: this.currentSessionId,
        toolCall,
        mode,
        reason,
        timestamp: Date.now()
      };
      this.pendingApprovals.set(id, { id, resolve, request });
      this.send(mainWindow, IPC_CHANNELS.AGENT_APPROVAL_REQUEST, request);
      this.sendStatus(mainWindow, 'waiting_approval');
    });
  }

  /**
   * Read-only inspection loop used by Plan Mode so the model can look at the
   * repository before writing its plan (spec §7).
   */
  private async planToolLoop(
    mainWindow: BrowserWindow,
    provider: IAIProvider,
    projectPath: string,
    messages: ChatMessage[],
    token: number
  ): Promise<string> {
    const settings = appStore.getSettings();
    const language: 'th' | 'en' = settings.language === 'en' ? 'en' : 'th';
    let accumulated = '';
    let guard = 0;
    const maxInspections = 6;

    while (guard < maxInspections) {
      guard++;
      let text = '';
      let toolCalls: ToolCall[] = [];

      await this.runProviderCall(
        mainWindow,
        provider,
        this.currentProviderId,
        this.currentModelId,
        {
          model: this.currentModelId,
          messages,
          tools: toolRegistry.getToolDefinitions('plan'),
          reasoningEffort: settings.reasoningEffort,
          sessionId: this.currentSessionId,
          signal: this.abortController?.signal
        },
        (chunk) => {
          if (chunk.content) text += chunk.content;
          if (chunk.toolCalls) toolCalls = [...toolCalls, ...chunk.toolCalls];
        },
        { mode: 'plan', startedAt: Date.now(), label: 'plan-inspect', token }
      );

      accumulated += text;

      const inspections = toolCalls.filter((tc) => {
        const perm = permissionEngine.check('safe', tc);
        return perm.allowed && !perm.requiresApproval;
      });

      if (inspections.length === 0) break;

      messages.push({
        id: `plan_asst_${guard}`,
        role: 'assistant',
        content: text,
        toolCalls: inspections,
        timestamp: Date.now()
      });

      for (const tc of inspections) {
        this.sendEvent(mainWindow, {
          id: `plan_tc_${tc.id}`,
          type: 'tool_call',
          title: tc.name,
          content: JSON.stringify(tc.args, null, 2),
          toolCall: tc,
          status: 'running',
          timestamp: Date.now()
        });
        // Planning reads are the most repeated calls in a whole session, so the
        // ledger is consulted here first as well (§39).
        const verdict = this.ledger.inspect(tc);
        if (verdict.action === 'reuse') {
          const cached = verdict.cached ?? '';
          this.sendEvent(mainWindow, {
            id: `plan_tr_${tc.id}`,
            type: 'tool_result',
            title: language === 'th' ? `${tc.name} (ใช้ผลเดิม)` : `${tc.name} (reused)`,
            content: cached.slice(0, 4000),
            toolResult: { toolCallId: tc.id, success: true, output: cached },
            status: 'success',
            details: { reused: true, count: verdict.count },
            timestamp: Date.now()
          });
          messages.push({
            id: `plan_reuse_${tc.id}`,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: `${cached.slice(0, 12000)}\n\n[${reuseNotice(language, verdict.count)}]`,
            timestamp: Date.now()
          });
          continue;
        }

        if (verdict.action === 'blocked') {
          const notice = loopNotice(language, tc, verdict.count);
          this.sendEvent(
            mainWindow,
            this.errorItem(language === 'th' ? 'หยุดการวนซ้ำ' : 'Stopped a repeated call', notice)
          );
          messages.push({
            id: `plan_block_${tc.id}`,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: notice,
            timestamp: Date.now()
          });
          continue;
        }

        const result = await this.executeTool(tc, projectPath, () => {});
        if (result.success) {
          this.ledger.remember(
            tc,
            typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
          );
        }
        this.sendEvent(mainWindow, {
          id: `plan_tr_${tc.id}`,
          type: 'tool_result',
          title: `${tc.name} Result`,
          content: result.success
            ? typeof result.output === 'string'
              ? result.output.slice(0, 4000)
              : JSON.stringify(result.output).slice(0, 4000)
            : `Error: ${result.error}`,
          toolResult: result,
          status: result.success ? 'success' : 'failed',
          timestamp: Date.now()
        });
        messages.push({
          id: `plan_toolres_${tc.id}`,
          role: 'tool',
          toolCallId: tc.id,
          name: tc.name,
          content: result.success
            ? typeof result.output === 'string'
              ? result.output.slice(0, 12000)
              : JSON.stringify(result.output).slice(0, 12000)
            : `Error: ${result.error}`,
          timestamp: Date.now()
        });
      }
    }

    return accumulated;
  }

  private async buildMentionContext(prompt: string, projectPath: string) {
    const mentions = Array.from(prompt.matchAll(/@([\w./\\-]+)/g)).map((m) => m[1]);
    const unique = Array.from(new Set(mentions)).slice(0, 6);
    const items: { name: string; content: string }[] = [];

    for (const mention of unique) {
      if (mention === 'git') {
        try {
          const diff = await gitService.getDiff(projectPath);
          if (diff.trim()) items.push({ name: 'git diff', content: diff.slice(0, 8000) });
        } catch {
          // Not a git repository — nothing to attach.
        }
        continue;
      }
      if (mention === 'terminal' || mention === 'selection') continue;
      const item = contextEngine.resolveMention(`@${mention}`, projectPath);
      if (item) items.push({ name: item.name, content: item.content.slice(0, 12000) });
    }

    return items;
  }
}

export const agentRuntime = new AgentRuntime();

// The agent and provider streams are the ones to read when a task went wrong
// (spec §66), so the runtime's run boundaries and provider failures are logged.
agentRuntime.onLog = (channel, level, message, context) => logService.log(channel, level, message, context);
