import { BrowserWindow } from 'electron';
import {
  AgentMode,
  AgentStatus,
  AppSettings,
  AgentQuestion,
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
  QuestionAnswer,
  SessionTranscript,
  SubagentRole,
  ToolCall,
  ToolResult
} from '../../../shared/types';
import {
  formatAnswersForModel,
  isAnswerable,
  normalizeAnswer,
  normalizeQuestions,
  questionCardTitle
} from '../../../shared/questions';
import { IPC_CHANNELS } from '../../../shared/ipc-events';
import { parseAssignment, TEAM_ROLE_LABEL, type TeamRole } from '../../../shared/ai-team';
import { providerManager, AutoRouteDecision } from '../providers/provider-manager';
import { IAIProvider, classifyThrownError } from '../providers/provider-interface';
import { toolRegistry, detectScriptCommand, hasPackageScript } from '../tools/tool-registry';
import { permissionEngine } from '../../security/permission-engine';
import { contextEngine } from '../context/context-engine';
import { SUBAGENTS, SubagentDefinition, buildSubagentSystemPrompt, getSubagent } from './subagents';
import { buildCompletionSummary } from './completion-summary';
import { buildFollowUpSuggestions } from '../../../shared/followup-suggestions';
import {
  RunLedger,
  LoopVerdict,
  loopNotice,
  repetitionNotice,
  reuseNotice,
  tokenDisciplineRules,
  compressForBudget
} from './token-discipline';
import { formatMission } from './mission-prompt';
import { destructiveRequested, formatRulesBlock, lawEnabled } from '../../../shared/rules';
import { readRulesFile, userRulesPath } from '../context/rules-files';
import {
  ProjectMemory,
  buildMemoryBlock,
  memoryIdleRule,
  memoryUpkeepRules,
  readProjectMemory
} from '../../project/project-memory';
import { ProjectDesign, readProjectDesign, writeProjectDesign } from '../../project/design-store';
import { DESIGN_PROFILES, DesignStyle, buildDesignBrief, designQuestion } from '../../../shared/design-profiles';
import {
  recommendedStyleFor,
  styleRecommendation,
  isUiWorkRequest,
  isContinuationPrompt,
  isSmallTalkOnly
} from '../../project/style-recommender';
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

/**
 * How to answer a message that asks for nothing.
 *
 * Written as an explicit instruction because every other line of the prompt
 * points the other way: "analyze before executing", "check your work against the
 * design profile", "end every task by updating the project memory". A model given
 * those and a greeting will look for the task in it, and finding none will invent
 * one — usually "summarise this project" — which is a lot of tool calls and a
 * wall of text in reply to "สวัสดีครับ".
 *
 * It also names the two things that most often leaked into those replies: an
 * unrequested survey, and a list of jobs offered as "what I can do next".
 */
function smallTalkDirective(language: 'th' | 'en'): string {
  return language === 'th'
    ? `
## ข้อความนี้ไม่ใช่งาน
ผู้ใช้ทักทายหรือพูดรับทราบเฉย ๆ ตอบตามที่เขาพูดใน 1–3 ประโยค และ:
- ห้ามเรียกเครื่องมือใด ๆ (ไม่ต้อง git status ไม่ต้องอ่านไฟล์ ไม่ต้องลิสต์โฟลเดอร์)
- ห้ามสำรวจหรือสรุปภาพรวมโปรเจกต์ เพราะไม่มีใครขอ
- ห้ามเสนอแผนงานหรือรายการงานที่ "ทำได้ต่อ" — ถ้าอยากรู้ ให้ถามสั้น ๆ 1 ประโยค
- ถ้าเป็นการทักทาย ให้ทักตอบ แล้วถามว่าอยากให้ทำอะไรต่อ`
    : `
## This message is not a task
The user greeted you or acknowledged something. Answer in one to three sentences, and:
- Do not call any tool (no git status, no reading files, no listing folders)
- Do not survey or summarise the project — nobody asked for it
- Do not offer a plan or a list of work you could do next — if you want to know, ask one short question
- If it is a greeting, greet back and ask what they would like to work on`;
}

/**
 * Shown when a tool call arrives on a run that was given no tools at all.
 *
 * The prompt already says "do not call any tool"; that is a request, and a model
 * leaning on its cached tool schema can ignore it. The engine therefore also
 * leaves the tool list out of the request, and refuses anything that comes back
 * anyway, so the ceiling is the harness rather than the model's good behaviour.
 */
function withheldToolsNotice(language: 'th' | 'en'): string {
  return language === 'th'
    ? 'ข้อความนี้ไม่ใช่งาน จึงไม่มีการเปิดเครื่องมือให้ใช้ และไม่มีการรันเครื่องมือนี้'
    : 'This message was not a task, so no tools were offered and this call was refused.';
}

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
  /** True while the current run is a continuation of earlier work. */
  private isContinuationRun = false;
  /**
   * True for the length of a run whose message was not a task (a greeting, a
   * thank-you). Set once per run, from the same verdict the composer uses.
   *
   * It is deliberately more than "the tools are missing". Such a run is an
   * *answer*: no tools, no plan branch, no build step list, no completion report,
   * no "what next" chips. Dressing a greeting as a build run was the rest of the
   * over-answer — the survey was only the part that could be seen in the text.
   */
  private answerOnly = false;
  private pendingDesignProject: string | null = null;
  /** Waiting question card: the run is parked until the user answers. */
  private pendingQuestionResolver: ((answer: QuestionAnswer) => void) | null = null;
  /** Resolver for the step-by-step gate between build steps (spec §35). */
  private pendingStepResolver: ((decision: PlanStepDecision) => void) | null = null;
  private pendingApprovals = new Map<string, PendingApproval>();
  private sessionApprovals = new Set<string>();
  private currentTaskPrompt = '';
  private currentProjectPath = '';
  /**
   * Whether *this request* asked for the project to be destroyed.
   *
   * Read from the user's own message by `destructiveRequested`, never from the
   * model's account of it: the law is "never delete the project unless you were
   * told", and the only trustworthy record of what the user said is their
   * message. It stays false unless they said it in so many words.
   */
  private destructiveIntent = false;
  private currentMode: AgentMode = 'build';
  private currentSessionId = '';
  private currentProviderId = '';
  private currentModelId = '';
  private activeWindow: BrowserWindow | null = null;
  /** Files touched anywhere in this run, including by subagents. */
  private runAffectedFiles = new Set<string>();
  /** Builds/tests this run actually executed, for the completion summary (§88). */
  private runValidations: { command: string; ok: boolean }[] = [];
  /** Every file change this run produced, for the end-of-run file card. */
  private runFileChanges: FileChange[] = [];
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
   * a run can never end silently — cancelled, hit its token ceiling and failed
   * all say so in the timeline (spec §84).
   */
  private stopReason: 'none' | 'completed' | 'cancelled' | 'budget' | 'error' = 'none';
  /** Token accounting for the live meter and the per-run ceiling. */
  private runTokens = 0;
  private tokensSaved = 0;
  private lastPromptTokens = 0;
  private tokenMeterAnnounced = 0;

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
    if (this.thriftActive()) return Math.min(settings.contextTokenBudget || 48_000, 20_000);
    return settings.contextTokenBudget || 48_000;
  }

  /** Tokens this run may spend before it stops and says so (0 = no ceiling). */
  private runTokenCap(): number {
    const settings = appStore.getSettings();
    const configured = settings.runTokenBudget || 0;
    if (this.thriftActive()) return configured > 0 ? Math.min(configured, 150_000) : 150_000;
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
   * The model sitting in a team seat for this run, when usable.
   *
   * An empty seat, a malformed assignment (`parseAssignment` nulls those) or a
   * provider that is disabled/missing all resolve to null, and the caller keeps
   * the model the composer chose — one typo in Settings must cost a seat, not
   * the run. The current provider/model are captured at construction time, so
   * the seat travels with the run's own model, not whatever the settings say now.
   */
  private teamSeat(role: TeamRole): { providerId: string; modelId: string } | null {
    const seat = parseAssignment(appStore.getSettings().aiTeam?.[role]);
    if (!seat) return null;
    const config = providerManager.getConfig(seat.providerId);
    if (!config || config.enabled === false) return null;
    return seat;
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
      // A continuation run reaches here only when the style is genuinely unset
      // AND asking is disabled; it must never see the "ask the user"
      // instruction, which would make the model stop and ask exactly what the
      // user told it not to.
      if (this.isContinuationRun) {
        return isUiWork ? `\n\n${buildDesignBrief(fallback, language)}` : '';
      }
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
        thrift: this.thriftActive()
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
    // runtime owns the provider connection, the token ceiling and the approval gate.
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
    if (this.pendingQuestionResolver) {
      // Cancelling must not leave the run waiting on a card that will never be
      // answered; `skipped` is what the model is told the user did.
      this.pendingQuestionResolver({ answers: [], skipped: true });
      this.pendingQuestionResolver = null;
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
    language: 'th' | 'en',
    evidence: { prompt: string; projectPath: string }
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingDesignProject = projectPath;
      this.pendingDesignResolver = () => resolve(true);
      // The AI's own lean, shown on the card as a pre-selected badge: most
      // users want a recommendation they can accept in one click, not four
      // equal choices to study.
      const recommended = recommendedStyleFor(evidence);
      this.sendEvent(mainWindow, {
        id: `design_card_${Date.now()}`,
        type: 'design',
        title: language === 'th' ? 'เลือกสไตล์หน้าจอให้โปรเจกต์นี้' : 'Choose this project’s screen style',
        content:
          language === 'th'
            ? 'เลือกครั้งเดียวแล้วจำไว้ให้โปรเจกต์นี้ — ทุกงานที่แตะหน้าจอหลังจากนี้จะยึดสไตล์นี้ให้เอง ไม่ต้องสั่งซ้ำทุกครั้ง'
            : 'Answered once and remembered for this project — every later task that touches the screen follows it, with no need to repeat yourself.',
        details: { projectPath, language, recommended, reason: styleRecommendation(recommended, language) },
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

  /**
   * Answers the question card the run is waiting on. Returns false when nothing
   * was asked — a stale renderer, or an answer for a card already decided.
   */
  answerQuestions(answer: QuestionAnswer): boolean {
    const resolver = this.pendingQuestionResolver;
    if (!resolver) return false;
    this.pendingQuestionResolver = null;
    resolver(answer);
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

  /**
   * The next-move chips under a finished run (spec §5).
   *
   * Grounded in what this run actually did — a failed build asks to be fixed,
   * an open todo asks to be continued, a clean change asks to be reviewed or
   * committed — which is what makes a chip worth clicking rather than furniture.
   * Sent through the agent event stream but deliberately *not* recorded in the
   * transcript: it is an affordance for the person on screen, not part of the
   * conversation a replay should show. Fired from `run()`'s finally so every
   * exit path — completed, failed, cancelled — offers a way onward.
   */
  private sendFollowUpSuggestions(mainWindow: BrowserWindow): void {
    // No "what next" chips on an answer: with nothing done in the run, every
    // chip left to offer is "explore this project" or "suggest next tasks" — the
    // unrequested work list, in chip form this time.
    if (this.answerOnly) return;
    try {
      const suggestions = buildFollowUpSuggestions({
        language: appStore.getSettings().language,
        changedFiles: Array.from(this.runAffectedFiles),
        validations: this.runValidations,
        todos: this.sessionTodos,
        unfinished: this.stopReason === 'budget',
        retryPrompt: this.status === 'failed' ? this.currentTaskPrompt : undefined
      });
      if (suggestions.length === 0) return;
      this.send(mainWindow, IPC_CHANNELS.AGENT_EVENT, { type: 'suggestions', suggestions });
    } catch {
      // A chip that cannot be built must never take the closing note down with it.
    }
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
   * Asks the user, and waits.
   *
   * The card is the only artifact on screen: it carries the questions, and the
   * answer is written back onto the very same transcript item, so replaying a
   * session shows what was decided instead of a question that looks unanswered.
   * The run parks in `waiting_approval`, which is exactly what it is — work
   * stopped, waiting on a person.
   */
  private async askUser(
    mainWindow: BrowserWindow,
    questions: AgentQuestion[],
    language: 'th' | 'en'
  ): Promise<QuestionAnswer> {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.sendEvent(mainWindow, {
      id,
      type: 'question',
      title: questionCardTitle(language),
      content:
        language === 'th'
          ? 'เลือกคำตอบด้านล่าง แล้วกด “ตอบ” เพื่อให้งานเดินต่อ'
          : 'Pick your answers below, then press Answer to let the work continue.',
      details: { questions, language },
      timestamp: Date.now()
    });
    this.sendStatus(mainWindow, 'waiting_approval');

    const answer = await new Promise<QuestionAnswer>((resolve) => {
      this.pendingQuestionResolver = resolve;
    });

    this.pendingQuestionResolver = null;
    this.recordQuestionAnswer(id, answer);
    if (!this.cancelled) this.sendStatus(mainWindow, 'running');
    return answer;
  }

  /** The answer, attached to the card that asked the question. */
  private recordQuestionAnswer(id: string, answer: QuestionAnswer): void {
    const item = this.sessionTimeline.find((entry) => entry.id === id);
    if (!item) return;
    item.details = { ...(item.details || {}), answer };
    this.scheduleTranscriptFlush();
  }

  /**
   * The `ask_question` tool.
   *
   * Answered here rather than in the tool registry because only the runtime can
   * reach the window, and only the runtime owns the waiting/aborted lifecycle
   * of a parked run. Returns null for every other tool, so callers can use it as
   * "is this a question?" without repeating the name check.
   */
  private async handleQuestionCall(
    mainWindow: BrowserWindow,
    toolCall: ToolCall,
    language: 'th' | 'en'
  ): Promise<ToolResult | null> {
    if (toolCall.name !== 'ask_question') return null;

    const rawArgs = (toolCall.args || {}) as Record<string, unknown>;
    const questions = normalizeQuestions(rawArgs.questions ?? rawArgs.question).filter(isAnswerable);

    if (questions.length === 0) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error:
          'ask_question needs at least one question with a "question" string, and 2-4 options per question.'
      };
    }

    const answer = await this.askUser(mainWindow, questions, language);
    return {
      toolCallId: toolCall.id,
      success: true,
      output: formatAnswersForModel(language, questions, answer)
    };
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
   * No run ends without saying so. A cancelled, capped or failed run used to
   * leave the transcript hanging on whatever the last tool printed — which is
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
        ? 'หยุดเพราะถึงงบโทเคนของงานนี้ — ดูรายละเอียดด้านบน แล้วส่งข้อความ "ทำต่อจากที่ค้างอยู่" เพื่อไปต่อ'
        : 'Stopped at this run\'s token ceiling — see above, then send "continue where you left off" to carry on.',
      error: th
        ? `การทำงานหยุดเพราะข้อผิดพลาดของผู้ให้บริการ งานที่ทำไปแล้ว ${changed} ไฟล์ถูกเก็บไว้ \nแก้สาเหตุ (คีย์/โมเดล/เครือข่าย) แล้วส่งข้อความอีกครั้งเพื่อทำต่อ`
        : `The run stopped on a provider error. ${changed} file(s) were kept.\nFix the cause (key, model, network), then send another message to continue.`
    };

    const titles: Record<'cancelled' | 'budget' | 'error', [string, string]> = {
      cancelled: ['หยุดการทำงานแล้ว', 'Run stopped'],
      budget: ['หยุดเพราะงบโทเคน', 'Stopped: token ceiling'],
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

  /**
   * What the guardrails need to judge one tool call: the folder the run was
   * given, and whether the user asked for destruction in their own words.
   */
  private permissionContext(language: 'th' | 'en') {
    return {
      projectPath: this.currentProjectPath,
      explicitDestructiveRequest: this.destructiveIntent,
      language,
      disabledLaws: this.disabledLaws()
    };
  }

  /**
   * The standing laws this user switched off.
   *
   * Read from settings rather than cached at construction: the switch takes
   * effect on the next tool call, the same way the permission mode does, and a
   * copied array would keep enforcing a law the user just turned off.
   */
  private disabledLaws(): string[] {
    try {
      const laws = appStore.getSettings().disabledLaws;
      return Array.isArray(laws) ? laws : [];
    } catch {
      return [];
    }
  }

  /** Is this law in force for this run? */
  private lawOn(id: string): boolean {
    return lawEnabled(id, this.disabledLaws());
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
      // A key that is stored but no longer decryptable is a different problem
      // from having no key at all: sending the user to an empty field they have
      // already filled in reads as the app forgetting their work.
      if (config.keyUnreadable) {
        return {
          error:
            language === 'th'
              ? `คีย์ที่บันทึกไว้ของ ${config.name} ใช้ไม่ได้แล้ว (ตัวเข้ารหัสของระบบเปลี่ยน) — ไปที่ Settings → AI Providers แล้ววางคีย์อีกครั้ง`
              : `The saved key for ${config.name} can no longer be read (the OS keychain changed) — open Settings → AI Providers and paste it again.`
        };
      }
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
      maxToolChars: this.thriftActive() ? 800 : 2500,
      keepRecent: this.thriftActive() ? 4 : 8
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
      // After the closing note, so the chips appear underneath it rather than
      // being scrolled away by it.
      this.sendFollowUpSuggestions(mainWindow);
      if (this.transcriptTimer) {
        clearTimeout(this.transcriptTimer);
        this.transcriptTimer = null;
      }
      this.writeTranscript(true);
    }
  }

  /**
   * The tool list for one request — or nothing at all.
   *
   * A message that is not a task is sent with no tools: a request that carries
   * no tool schema cannot turn into a file read, a terminal command or a survey,
   * whichever way the model was leaning. The prompt-level directive above asks
   * the model to hold back; leaving the list out does not depend on it agreeing.
   */
  private toolDefinitionsFor(mode: 'plan' | 'build'): ReturnType<typeof toolRegistry.getToolDefinitions> | undefined {
    if (this.answerOnly) return undefined;
    return toolRegistry.getToolDefinitions(mode);
  }

  private async runInternal(mainWindow: BrowserWindow, args: AgentRunArgs): Promise<void> {
    const { prompt, mode, projectPath, conversationHistory = [] } = args;
    let images = Array.isArray(args.images) ? args.images.slice(0, 6) : [];
    this.cancel();
    this.abortController = new AbortController();
    const token = ++this.runToken;
    this.cancelled = false;
    this.isContinuationRun = isContinuationPrompt(prompt);
    // Reset before anything can read it: one greeting must not mute the tools of
    // the next, real request in this session.
    this.answerOnly = false;
    this.stopReason = 'none';
    this.runTokens = 0;
    this.tokensSaved = 0;
    this.lastPromptTokens = 0;
    this.tokenMeterAnnounced = 0;
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
      this.runFileChanges = [];
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
    // The user's own words decide whether a destructive request is allowed at
    // all. Reading it here — once, from the request that started this run —
    // means a model cannot authorise its own deletion by describing it as
    // something the user wanted.
    this.destructiveIntent = destructiveRequested(prompt);
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
    // Ask about the style before writing any UI in a project that has not chosen
    // one. The user asked to be asked instead of having a look invented for them,
    // and answered once it is remembered — so this costs one question per project,
    // not one per prompt.
    //
    // The decision is made on the *prompt*: is this an order to build or change a
    // screen (a product brief counts — "ทำโปรแกรมอสังหา" names no interface and
    // produces one). It used to also accept "the project has UI files", which in
    // any app of this size meant every message — a greeting included — stopped for
    // a style question the user had not asked for. Small talk, questions and
    // continuations ("ทำต่อ", "finish it") never raise it: they carry no new
    // design decision, and asking on them was the loudest complaint of all.
    const looksLikeUiWork = isUiWorkRequest(prompt);
    const shouldAskDesign =
      this.currentMode !== 'plan' &&
      design.style === 'ask' &&
      appStore.getSettings().askDesignBeforeUiWork !== false &&
      looksLikeUiWork;

    if (shouldAskDesign) {
      const answered = await this.askDesignStyle(mainWindow, projectPath, language, { prompt, projectPath });
      if (this.cancelled) return;
      if (answered) design = readProjectDesign(projectPath);
    }

    const designBlock = this.designBlock(design, looksLikeUiWork, language);
    // A greeting is answered, not worked on. Left to itself the agent reads
    // "always analyze before executing" and the memory upkeep rule as one
    // standing order to survey the project, so a "สวัสดีครับ" came back as a
    // table of the folder layout and a list of jobs nobody asked for. The
    // classification is the same one that decides whether to raise the style
    // card — a message with no order in it — and it is stated in the prompt,
    // because the model cannot be relied on to know how much answer is enough.
    // The verdict decides the mode of the run, not just its tone. There is no
    // build to build and no plan to plan in "สวัสดีครับ", so the run is marked as
    // an answer: the tools are withheld, the plan branch is skipped, and the run
    // reports itself as neither. Asking the composer to say so too is the other
    // half of the same decision.
    const smallTalk = isSmallTalkOnly(prompt);
    this.answerOnly = smallTalk;
    const smallTalkBlock = smallTalk ? smallTalkDirective(language) : '';
    // One law book, in every prompt, whatever provider is answering: the laws
    // the engine enforces, then the user's own rules, then the project's. It is
    // the same text the RULES card shows, so what the user reads is what the
    // model was told.
    const rulesBlock = formatRulesBlock({
      projectRules,
      userRules: readRulesFile(userRulesPath(appStore.getDataDir())) ?? '',
      language,
      disabledLaws: this.disabledLaws()
    });

    const systemPrompt = `You are D4IDE, an elite autonomous AI software engineering agent.
Operating System: ${process.platform === 'win32' ? 'Windows' : process.platform}
Current Project Path: ${projectPath}
Working directory for all paths: ${projectPath}
User Interface Language: ${language === 'th' ? 'Thai (ไทย)' : 'English'}
Instructions:
1. Always analyze before executing file changes.
2. Use tools to read files, search, list directories, and execute terminal commands.
3. Keep file modifications focused and targeted; prefer edit_file over rewriting whole files.
4. If asked in Plan Mode, produce a structured implementation plan with clear steps, affected files, and risk. If the request leaves a real decision open that would change what you build, call ask_question first instead of assuming.
5. In Build Mode, follow through and implement the complete task autonomously. Run build or tests when appropriate. When a detail that would change what you write is genuinely missing (which store, which provider, which currency, which folder, how far this round goes), call ask_question once with 2-4 options per question rather than guessing; when the request is already complete, do not ask anything. When the user asks to continue (Thai "ทำต่อ" or similar), resume the existing work using the answers and files already recorded — never re-ask a question that was already answered (style, stack, scope), and never restart from scratch.
6. Write every message the user reads — including the final summary — in ${language === 'th' ? 'Thai (ไทย)' : 'English'}, whatever language the tool output or earlier messages use. Keep code, identifiers, file paths and quoted command output verbatim.
7. Anything that changes what the user sees is not done until you have looked at it: start the dev server in the background, browser_navigate to the page, browser_screenshot it, read browser_inspect and browser_console, and then judge the screenshot against the design profile — spacing, alignment, hierarchy, contrast, overflow, empty states. Fix what the render reveals and take a second screenshot before reporting. A screen you have not seen renders is not finished, and "it should look good" is not evidence. Every screen you build is Mobile UI and Responsive on all devices by default: design mobile-first (360px) up to desktop (1440px+), never fix a width in px, never let a table or grid overflow a small screen, and verify one narrow-viewport screenshot before reporting.
10. Check your own work against the design profile like a reviewer would: does every colour, radius, shadow and gap come from the tokens? Is the Thai text free of clipped tone marks, is anything overflowing its box, are focus and hover states visible? Fix these before the user has to point them out.
8. Never run a dev server or watch command in the foreground: call run_terminal with background: true so it keeps running in a terminal while you carry on, and pass its port when you know it. The preview panel opens on the address the server prints — tell the user the address once it is up.
9. ${smallTalk ? memoryIdleRule(language) : memoryUpkeepRules(language)}
${smallTalkBlock}${memoryBlock}${designBlock}
${rulesBlock}

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
    // A greeting has no plan in it: planning mode would answer "สวัสดีครับ" with
    // an inspection loop and an approval card, which is the same overreach as the
    // project survey, one card later.
    if (mode === 'plan' && !this.answerOnly) {
      this.sendStatus(mainWindow, 'planning');
      this.sendEvent(mainWindow, {
        id: `plan_start_${Date.now()}`,
        type: 'thinking',
        title: language === 'th' ? 'กำลังวิเคราะห์โปรเจกต์และวางแผน...' : 'Analyzing project & formulating plan...',
        timestamp: Date.now()
      });

      // The planner seat (AI team): when filled, the plan is written by the
      // assigned model instead of the composer's. teamSeat already validated the
      // provider exists and is enabled; the `|| provider` is belt-and-braces so
      // an instance that vanished mid-run degrades to the main model, not an error.
      const plannerSeat = this.teamSeat('planner');
      const planProvider = (plannerSeat && providerManager.getProvider(plannerSeat.providerId)) || provider;
      if (plannerSeat && planProvider !== provider) {
        this.sendEvent(mainWindow, {
          id: `team_planner_${Date.now()}`,
          type: 'thinking',
          title: `${TEAM_ROLE_LABEL.planner[language]} · AI Team`,
          content:
            language === 'th'
              ? `แผนนี้เขียนโดย ${plannerSeat.providerId}/${plannerSeat.modelId} ตามที่ตั้งค่าทีม AI ไว้`
              : `The plan is written by ${plannerSeat.providerId}/${plannerSeat.modelId}, as configured for the AI team.`,
          timestamp: Date.now()
        });
      }

      messages.push({
        id: `p_${Date.now()}`,
        role: 'user',
        content: this.planningInstruction(prompt, language),
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
          planAccumulated = await this.planToolLoop(mainWindow, planProvider, projectPath, messages, token, plannerSeat);
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
    // (An answer-only run comes through here too — the loop is how a reply is
    // requested — but it carries no tools, so it ends on its first round.)
    // The executor seat (AI team): when filled, the file-editing loop runs on the
    // assigned model. Answer-only runs keep the run's model — a greeting is not
    // work, and the executor seat is for work.
    const executorSeat = this.answerOnly ? null : this.teamSeat('executor');
    const executorProvider = (executorSeat && providerManager.getProvider(executorSeat.providerId)) || provider;
    const executorProviderId = executorSeat?.providerId ?? providerId;
    const executorModelId = executorSeat?.modelId ?? modelId;
    if (executorSeat && executorProvider !== provider) {
      this.sendEvent(mainWindow, {
        id: `team_executor_${Date.now()}`,
        type: 'thinking',
        title: `${TEAM_ROLE_LABEL.executor[language]} · AI Team`,
        content:
          language === 'th'
            ? `การลงมือแก้ไฟล์ทำโดย ${executorSeat.providerId}/${executorSeat.modelId} ตามที่ตั้งค่าทีม AI ไว้`
            : `File edits run on ${executorSeat.providerId}/${executorSeat.modelId}, as configured for the AI team.`,
        timestamp: Date.now()
      });
    }
    this.sendStatus(mainWindow, 'running');
    let stepCount = 0;
    // Cheaper mode means fewer steps, not just a politer prompt.
    const maxSteps = this.thriftActive()
      ? Math.min(settings.maxAgentSteps || 30, 12)
      : settings.maxAgentSteps || 30;
    let finished = false;

    // The step list is the shape of the work on screen: four build steps for a
    // task, one row for an answer. A greeting used to raise the same four rows
    // and tick them off, which claimed build work that never happened.
    const liveTodos: AgentTodo[] = this.answerOnly
      ? [
          {
            id: '1',
            text: language === 'th' ? 'ตอบกลับข้อความ (ไม่ใช่งาน)' : 'Answer the message (no task)',
            status: 'in_progress'
          }
        ]
      : [
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

      // A ceiling the user can see and predict, counted in tokens rather than in
      // money: without it, "cheap mode" was a promise and a long run could spend
      // as much as it liked.
      const tokenCap = this.runTokenCap();
      if (tokenCap > 0 && this.runTokens >= tokenCap) {
        this.sendEvent(mainWindow, {
          id: `tokencap_${Date.now()}`,
          type: 'error',            title: language === 'th' ? 'ถึงงบโทเคนของงานนี้' : 'Run token ceiling reached',
          content:
            language === 'th'
              ? `งานนี้ใช้ไปประมาณ ${this.runTokens.toLocaleString()} โทเคน (เพดาน ${tokenCap.toLocaleString()}) จึงหยุดตรงนี้ ` +
                'เพื่อไม่ให้บิลบานปลาย ไฟล์ที่แก้แล้วยังอยู่ครบ — ส่งข้อความ "ทำต่อจากที่ค้างอยู่" เพื่อไปต่อ หรือปรับเพดานที่ การตั้งค่า → การใช้งาน'
              : `This run spent about ${this.runTokens.toLocaleString()} tokens (ceiling ${tokenCap.toLocaleString()}), so it stopped here ` +
                'rather than run far past it. Files already changed are kept — send "continue where you left off" to carry on, or change the ceiling in Settings → Usage.',
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
          executorProvider,
          executorProviderId,
          executorModelId,
          {
            model: executorModelId,
            messages,
            tools: this.toolDefinitionsFor('build'),
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
          if (this.lawOn('no-loops') && this.ledger.isRepeatingText(assistantText)) {
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

        // Last line of defence. The tools were withheld, so a call here means
        // the provider answered from its own cached schema or the model simply
        // ignored the missing list. Either way nothing is executed, nobody is
        // asked to approve anything, and the run ends on the text it already
        // produced — the answer to "สวัสดีครับ" stays one or two sentences.
        if (this.answerOnly) {
          const notice = withheldToolsNotice(language);
          for (const tc of pendingToolCalls) {
            this.sendEvent(mainWindow, {
              id: `tc_${tc.id}`,
              type: 'tool_call',
              title: tc.name,
              content: JSON.stringify(tc.args, null, 2),
              toolCall: tc,
              status: 'failed',
              timestamp: Date.now()
            });
            this.sendEvent(mainWindow, {
              id: `tr_${tc.id}`,
              type: 'tool_result',
              title: language === 'th' ? `${tc.name} (ไม่ใช่งาน — ไม่รัน)` : `${tc.name} (not a task — refused)`,
              content: notice,
              toolResult: { toolCallId: tc.id, success: false, error: notice },
              status: 'failed',
              timestamp: Date.now()
            });
            appStore.appendToolAudit({
              id: `a_${Date.now()}_${tc.id}`,
              sessionId: this.currentSessionId,
              toolName: tc.name,
              argsPreview: JSON.stringify(tc.args).slice(0, 300),
              mode: this.livePermissionMode(),
              allowed: false,
              requiresApproval: false,
              decision: 'rejected',
              reason: notice,
              timestamp: Date.now()
            });
          }
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

          // `ask_question` is answered by the user, not by the tool registry, so
          // it is intercepted before permissions: there is nothing to approve
          // about asking a question, and the run has to be able to park here.
          const asked = await this.handleQuestionCall(mainWindow, tc, language);
          if (asked) {
            messages.push({
              id: `tc_asked_${Date.now()}_${tc.id}`,
              role: 'tool',
              toolCallId: tc.id,
              name: tc.name,
              content: asked.success ? String(asked.output ?? '') : `Tool Error: ${asked.error}`,
              timestamp: Date.now()
            });
            liveTodos[1].status = 'in_progress';
            this.sendTodos(mainWindow, liveTodos);
            continue;
          }

          const mode = this.livePermissionMode(mainWindow, language);
          const perm = permissionEngine.check(mode, tc, {}, this.permissionContext(language));
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
          //
          // The refusal is the "never loop" law, which the user can switch off;
          // the reuse below is not. Answering from a result already in hand is
          // token economy, and turning that off would only make a run cost more.
          const tried = this.ledger.inspect(tc);
          const verdict: LoopVerdict =
            tried.action === 'blocked' && !this.lawOn('no-loops') ? { action: 'run', count: tried.count } : tried;
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
            this.runFileChanges.push(change);
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

    // Whichever list this run carried, it ends with every row done — the build
    // rows by index would crash on the one-row answer list, and the intent was
    // always "close out the list", not "close out rows 2 through 4".
    for (const todo of liveTodos) todo.status = 'completed';
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
    //
    // An answer gets one line instead of the build report. "No files modified /
    // no validation command ran" is an honest report of work, and there was no
    // work: it reads as an empty task card under a two-sentence reply.
    const summaryText = this.answerOnly
      ? language === 'th'
        ? 'ตอบกลับข้อความสั้น ๆ — ไม่ได้แก้ไฟล์ ไม่ได้รันเครื่องมือ'
        : 'Answered the message — no files changed, no tool ran.'
      : buildCompletionSummary({
          language,
          changedFiles: Array.from(affectedFilesList),
          validations: this.runValidations,
          usage: sessionUsage
        });

    // The end of a run needs the file list where the work happened, the way
    // every serious IDE shows it: one row per file, additions green and
    // deletions red, before the cost line. Built from the run's own
    // file-change stream; the latest change per file is the one that counts.
    const fileTally = new Map<string, { additions: number; deletions: number; type: FileChange['type'] }>();
    for (const change of this.runFileChanges) {
      fileTally.set(change.relativePath, {
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        type: change.type
      });
    }
    if (fileTally.size > 0) {
      const th = language === 'th';
      const files = Array.from(fileTally.entries())
        .slice(0, 60)
        .map(([file, tally]) => ({ path: file, type: tally.type, additions: tally.additions, deletions: tally.deletions }));
      const totalAdd = Array.from(fileTally.values()).reduce((sum, tally) => sum + tally.additions, 0);
      const totalDel = Array.from(fileTally.values()).reduce((sum, tally) => sum + tally.deletions, 0);
      this.sendEvent(mainWindow, {
        id: `files_changed_${Date.now()}`,
        type: 'summary',
        title: th
          ? `ปรับไป ${fileTally.size} ไฟล์  (+${totalAdd} −${totalDel})`
          : `Changed ${fileTally.size} files (+${totalAdd} −${totalDel})`,
        details: { files },
        timestamp: Date.now()
      });
    }

    this.stopReason = 'completed';

    // The report goes where the cost is. It used to be a card in the middle of
    // the conversation, which interrupted the transcript and still said nothing
    // about which request it belonged to; the usage view answers "what did this
    // request do, and what did it cost" in one place, so the report is stored on
    // that request's usage row and the panel is refreshed to show it.
    const recordedSummary = appStore.saveRunSummary(
      this.currentSessionId,
      summaryText,
      prompt.replace(/\s+/g, ' ').trim().slice(0, 180)
    );
    if (recordedSummary) {
      this.send(mainWindow, IPC_CHANNELS.USAGE_EVENT, usageService.summary(this.currentSessionId));
    }

    // The changed-files card went out as a live event; the run ends here and the
    // app is often closed seconds later, so the debounced flush can lose the
    // very card the user was promised. Flushing now is what makes the summary
    // survive on the transcript a reopen reads.
    if (this.transcriptTimer) {
      clearTimeout(this.transcriptTimer);
      this.transcriptTimer = null;
    }
    this.writeTranscript(true);

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

    // A read-only subagent reads files and reports — the analyst seat (AI team)
    // is the explicit choice for exactly this work and outranks it; the cheaper-
    // model toggle is the economy fallback when no seat is assigned. A write-
    // capable one keeps the model the user chose: quality of the code matters
    // more than the saving. When neither is configured, nothing changes.
    const analystSeat = !definition.writeCapable ? this.teamSeat('analyst') : null;
    const cheap = !analystSeat && settings.cheaperModelForSmallTasks && !definition.writeCapable ? this.cheapModel() : null;
    const seat = analystSeat ?? cheap;
    const subagentProviderId = seat?.providerId ?? this.currentProviderId;
    const subagentModelId = seat?.modelId ?? this.currentModelId;
    const provider = providerManager.getProvider(subagentProviderId);
    if (!provider) throw new Error('The provider for this run is no longer available — start the task again.');
    if (analystSeat) {
      this.sendEvent(mainWindow, {
        id: `team_analyst_${Date.now()}`,
        type: 'thinking',
        title: `${TEAM_ROLE_LABEL.analyst[language]} · AI Team`,
        content:
          language === 'th'
            ? `${definition.label} สำรวจและรายงานโดย ${analystSeat.providerId}/${analystSeat.modelId} ตามที่ตั้งค่าทีม AI ไว้`
            : `${definition.label} surveys and reports on ${analystSeat.providerId}/${analystSeat.modelId}, as configured for the AI team.`,
        timestamp: Date.now()
      });
    } else if (cheap) {
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
    // A subagent wears the parent's rules, including the project boundary: it
    // runs on the same folder and the same request, so the same laws apply.
    const perm = permissionEngine.check(
      this.livePermissionMode(),
      toolCall,
      {},
      this.permissionContext(settings.language)
    );

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
      this.runFileChanges.push(change);
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
   * What Plan Mode asks the model to do, in order.
   *
   * The order is the point. An agent that jumps straight to a plan for an
   * underspecified request produces a plan for the wrong product, and the user's
   * only recourse is to read it and start over. So the first instruction is to
   * ask — with options the user can click — about anything that would change
   * what gets built, and only then to plan. The last section exists so the plan
   * shows which answers it is built on, and every assumption that was not asked.
   */
  private planningInstruction(prompt: string, language: 'th' | 'en'): string {
    const shared = `Request: "${prompt}"`;

    if (language === 'th') {
      return `${shared}

ขั้นที่ 1 — ถ้าก่อน: ถ้าคำขอนี้ยังเปิดช่องให้ตัดสินใจเรื่องที่ทำให้งานที่ได้ต่างกันจริง ๆ (ทำให้ใครใช้ · ข้อมูลจากไหน · แพลตฟอร์ม/ภาษา · หน้าตาและธีม · ขอบเขตของรอบแรก · งบหรือโฮสติ้ง · ระบบเดิมที่ต้องต่อด้วย) ให้เรียก ask_question ก่อน 1-4 ข้อ ข้อละ 2-4 ตัวเลือกที่ชัดเจน ห้ามเขียนแผนก่อนได้คำตอบ ถ้าไม่มีอะไรต้องถามจริง ๆ (คำขอระบุครบทุกอย่างแล้ว) ให้ข้ามไปขั้นที่ 2 เลย และถ้าคำตอบมาครบแล้วก็ห้ามถามซ้ำ

ขั้นที่ 2 — เขียนแผนเป็น markdown ที่มีหัวข้อเหล่านี้ครบ:
## สรุป — หนึ่งย่อหน้า: งานเสร็จแล้วจะได้อะไร
## ขั้นตอน — ไล่เลข แต่ละข้อทำจบและตรวจสอบได้เอง
## ไฟล์ที่เกี่ยวข้อง — ระบุพาธ แยกไฟล์ใหม่/ไฟล์ที่แก้
## ขอบเขต — รอบนี้ทำถึงไหน และตั้งใจไม่ทำอะไร
## ความเสี่ยง — Low/Medium/High พร้อมเหตุผล
## ข้อกำหนดที่ยืนยันแล้ว — คำตอบของผู้ใช้ และสมมติฐานที่ต้องตั้งเองถ้ามี

โหมดนี้ยังห้ามแก้ไฟล์ทุกกรณี`;
    }

    return `${shared}

STEP 1 — Ask, do not guess. If this request leaves any decision open that would change what actually gets built (who uses it · where the data comes from · platform or language · look and theme · how far the first iteration goes · budget or hosting · existing systems to integrate with), call ask_question FIRST with 1-4 questions, each with 2-4 concrete options. Do not write any part of the plan before the answers arrive. If there is genuinely nothing to ask — the request already fixes every decision — go straight to STEP 2, and once something has been answered do not ask it again.

STEP 2 — Produce the plan as markdown with every one of these sections:
## Summary — one paragraph: what exists when this is done
## Steps — numbered, each one executable and verifiable on its own
## Affected files — paths, split into new and changed
## Scope — how far this round goes, and what it deliberately leaves out
## Risk — Low/Medium/High with the reason
## Confirmed requirements — the user's answers, plus any assumption you had to make

Writing files is still forbidden in this mode.`;
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
    token: number,
    /** AI team: the planner seat; absent/null keeps the run's own model. */
    plannerSeat?: { providerId: string; modelId: string } | null
  ): Promise<string> {
    const plannerProviderId = plannerSeat?.providerId ?? this.currentProviderId;
    const plannerModelId = plannerSeat?.modelId ?? this.currentModelId;
    const settings = appStore.getSettings();
    const language: 'th' | 'en' = settings.language === 'en' ? 'en' : 'th';
    let accumulated = '';
    let guard = 0;
    // Room for a question round, a second question round after the answers, and
    // the reconnaissance reads in between — without letting the loop wander.
    const maxInspections = 8;

    while (guard < maxInspections) {
      guard++;
      let text = '';
      let toolCalls: ToolCall[] = [];

      await this.runProviderCall(
        mainWindow,
        provider,
        // AI team: the planner seat when assigned, otherwise the run's own.
        plannerProviderId,
        plannerModelId,
        {
          model: plannerModelId,
          messages,
          tools: this.toolDefinitionsFor('plan'),
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

      // Questions come first, and on their own: the plan that follows should be
      // built on the user's answers, not on assumptions made while asking.
      const questions = toolCalls.filter((tc) => tc.name === 'ask_question');
      const inspections = toolCalls.filter((tc) => {
        if (tc.name === 'ask_question') return false;
        // Planning reads pass through the same guardrails as everything else, so
        // even the reconnaissance step stays inside the project.
        const perm = permissionEngine.check('safe', tc, {}, this.permissionContext(language));
        return perm.allowed && !perm.requiresApproval;
      });

      if (questions.length === 0 && inspections.length === 0) break;

      messages.push({
        id: `plan_asst_${guard}`,
        role: 'assistant',
        content: text,
        toolCalls: [...questions, ...inspections],
        timestamp: Date.now()
      });

      for (const tc of questions) {
        const result = await this.handleQuestionCall(mainWindow, tc, language);
        if (this.isCancelled(token)) {
          this.sendStatus(mainWindow, 'cancelled');
          return '';
        }
        messages.push({
          id: `plan_ans_${tc.id}`,
          role: 'tool',
          toolCallId: tc.id,
          name: tc.name,
          content: result?.success ? String(result.output ?? '') : `Tool Error: ${result?.error}`,
          timestamp: Date.now()
        });
      }

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
        // ledger is consulted here first as well (§39), under the same law as
        // the main loop.
        const tried = this.ledger.inspect(tc);
        const verdict: LoopVerdict =
          tried.action === 'blocked' && !this.lawOn('no-loops') ? { action: 'run', count: tried.count } : tried;
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
