import { BrowserWindow } from 'electron';
import {
  AgentMode,
  AgentStatus,
  AgentTimelineItem,
  AgentTodo,
  ChatMessage,
  FileChange,
  PlanData,
  ToolCall
} from '../../../shared/types';
import { IPC_CHANNELS } from '../../../shared/ipc-events';
import { providerManager } from '../providers/provider-manager';
import { toolRegistry } from '../tools/tool-registry';
import { permissionEngine } from '../../security/permission-engine';
import { contextEngine } from '../context/context-engine';
import { appStore } from '../../database/store';

export class AgentRuntime {
  private abortController: AbortController | null = null;
  private status: AgentStatus = 'idle';
  private currentPlan: PlanData | null = null;
  private pendingPlanResolver: ((approved: boolean) => void) | null = null;
  private currentTaskPrompt = '';
  private currentProjectPath = '';
  private currentMode: AgentMode = 'build';

  getStatus(): AgentStatus {
    return this.status;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver(false);
      this.pendingPlanResolver = null;
    }
    this.status = 'cancelled';
  }

  approvePlan(): void {
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver(true);
      this.pendingPlanResolver = null;
    }
  }

  rejectPlan(): void {
    if (this.pendingPlanResolver) {
      this.pendingPlanResolver(false);
      this.pendingPlanResolver = null;
    }
  }

  private sendEvent(mainWindow: BrowserWindow, item: AgentTimelineItem): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_EVENT, { type: 'timeline', item });
    }
  }

  private sendStatus(mainWindow: BrowserWindow, status: AgentStatus): void {
    this.status = status;
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_EVENT, { type: 'status', status });
    }
  }

  private sendTodos(mainWindow: BrowserWindow, todos: AgentTodo[]): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_EVENT, { type: 'todos', todos });
    }
  }

  private sendFileChange(mainWindow: BrowserWindow, change: FileChange): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.AGENT_EVENT, { type: 'file_change', change });
    }
  }

  async run(
    mainWindow: BrowserWindow,
    prompt: string,
    mode: AgentMode,
    projectPath: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<void> {
    this.cancel();
    this.abortController = new AbortController();
    this.currentTaskPrompt = prompt;
    this.currentProjectPath = projectPath;
    this.currentMode = mode;

    const settings = appStore.getSettings();
    const provider = providerManager.getProvider(settings.activeProviderId);

    if (!provider) {
      this.sendEvent(mainWindow, {
        id: `err_${Date.now()}`,
        type: 'error',
        title: 'Provider Error',
        content: `Provider "${settings.activeProviderId}" is not configured or not found. Please open Settings -> AI Providers.`,
        timestamp: Date.now()
      });
      this.sendStatus(mainWindow, 'failed');
      return;
    }

    // Load project rules and setup system prompt
    const projectRules = contextEngine.loadProjectRules(projectPath);
    const systemPrompt = `You are D4IDE, an elite autonomous AI software engineering agent.
Operating System: Windows
Current Project Path: ${projectPath}
User Interface Language: ${settings.language === 'th' ? 'Thai (ไทย)' : 'English'}

${projectRules ? `Project Rules & Guidelines:\n${projectRules}\n` : ''}
Instructions:
1. Always analyze before executing file changes.
2. Use tools to read files, search, list directories, and execute terminal commands.
3. Keep file modifications focused and targeted.
4. If asked in Plan Mode, produce a structured implementation plan with clear steps, affected files, and risk.
5. In Build Mode, follow through and implement the complete task autonomously. Run build or tests when appropriate.
6. When responding or completing, summarize your work clearly in ${settings.language === 'th' ? 'Thai' : 'English'}.`;

    const messages: ChatMessage[] = [
      { id: 'sys', role: 'system', content: systemPrompt, timestamp: Date.now() },
      ...conversationHistory,
      { id: `u_${Date.now()}`, role: 'user', content: prompt, timestamp: Date.now() }
    ];

    const affectedFilesList = new Set<string>();
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // --- PLAN MODE FLOW ---
    if (mode === 'plan') {
      this.sendStatus(mainWindow, 'planning');
      this.sendEvent(mainWindow, {
        id: `plan_start_${Date.now()}`,
        type: 'thinking',
        title: settings.language === 'th' ? 'กำลังวิเคราะห์โปรเจกต์และวางแผน...' : 'Analyzing project & formulating plan...',
        timestamp: Date.now()
      });

      const planPromptMessages: ChatMessage[] = [
        ...messages,
        {
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
        }
      ];

      let planAccumulated = '';
      try {
        await provider.streamChat(
          {
            model: settings.activeModelId,
            messages: planPromptMessages,
            tools: toolRegistry.getToolDefinitions('plan'),
            reasoningEffort: settings.reasoningEffort,
            signal: this.abortController.signal
          },
          (chunk) => {
            if (chunk.content) {
              planAccumulated += chunk.content;
            }
            if (chunk.usage) {
              totalPromptTokens += chunk.usage.promptTokens;
              totalCompletionTokens += chunk.usage.completionTokens;
            }
          }
        );

        // Parse plan
        const planData: PlanData = {
          summary: planAccumulated,
          steps: planAccumulated.split('\n').filter((l) => /^\d+\./.test(l.trim())).map((l) => l.trim()),
          affectedFiles: [],
          estimatedScope: 'Medium',
          risk: 'Medium',
          approved: false
        };

        this.currentPlan = planData;
        this.sendEvent(mainWindow, {
          id: `plan_card_${Date.now()}`,
          type: 'plan',
          title: settings.language === 'th' ? 'แผนการทำงาน (Implementation Plan)' : 'Implementation Plan',
          content: planAccumulated,
          details: planData,
          timestamp: Date.now()
        });

        this.sendStatus(mainWindow, 'waiting_approval');

        // Wait for user approval
        const approved = await new Promise<boolean>((resolve) => {
          this.pendingPlanResolver = resolve;
        });

        if (!approved) {
          this.sendStatus(mainWindow, 'cancelled');
          this.sendEvent(mainWindow, {
            id: `plan_rej_${Date.now()}`,
            type: 'message',
            title: settings.language === 'th' ? 'แผนถูกยกเลิกโดยผู้ใช้' : 'Plan cancelled by user',
            timestamp: Date.now()
          });
          return;
        }

        // Approved! Switch to build mode to execute
        this.currentMode = 'build';
        messages.push({
          id: `plan_app_${Date.now()}`,
          role: 'user',
          content: `The user has approved the plan:\n${planAccumulated}\nPlease proceed with the implementation in Build Mode now.`,
          timestamp: Date.now()
        });
      } catch (err: any) {
        if (this.abortController?.signal.aborted) {
          this.sendStatus(mainWindow, 'cancelled');
          return;
        }
        this.sendEvent(mainWindow, {
          id: `err_${Date.now()}`,
          type: 'error',
          title: 'Planning Error',
          content: err.message || 'Error occurred while planning.',
          timestamp: Date.now()
        });
        this.sendStatus(mainWindow, 'failed');
        return;
      }
    }

    // --- BUILD MODE AGENT LOOP ---
    this.sendStatus(mainWindow, 'running');
    let stepCount = 0;
    const maxSteps = settings.maxAgentSteps || 30;
    let finished = false;

    // Track todos
    const liveTodos: AgentTodo[] = [
      { id: '1', text: settings.language === 'th' ? 'วิเคราะห์ความต้องการ' : 'Analyze requirement', status: 'completed' },
      { id: '2', text: settings.language === 'th' ? 'ดำเนินการแก้ไขโค้ด' : 'Implement changes', status: 'in_progress' },
      { id: '3', text: settings.language === 'th' ? 'ตรวจสอบและรันการทดสอบ' : 'Verify & test', status: 'pending' },
      { id: '4', text: settings.language === 'th' ? 'สรุปผลการทำงาน' : 'Finalize summary', status: 'pending' }
    ];
    this.sendTodos(mainWindow, liveTodos);

    while (!finished && stepCount < maxSteps) {
      if (this.abortController?.signal.aborted) {
        this.sendStatus(mainWindow, 'cancelled');
        return;
      }

      stepCount++;
      let assistantText = '';
      let pendingToolCalls: ToolCall[] = [];

      try {
        await provider.streamChat(
          {
            model: settings.activeModelId,
            messages,
            tools: toolRegistry.getToolDefinitions('build'),
            reasoningEffort: settings.reasoningEffort,
            signal: this.abortController.signal
          },
          (chunk) => {
            if (chunk.content) {
              assistantText += chunk.content;
            }
            if (chunk.toolCalls && chunk.toolCalls.length > 0) {
              pendingToolCalls = chunk.toolCalls;
            }
            if (chunk.usage) {
              totalPromptTokens += chunk.usage.promptTokens;
              totalCompletionTokens += chunk.usage.completionTokens;
            }
          }
        );

        if (assistantText.trim()) {
          this.sendEvent(mainWindow, {
            id: `msg_${Date.now()}_${stepCount}`,
            type: 'message',
            title: 'D4 Agent',
            content: assistantText,
            timestamp: Date.now()
          });
        }

        // If no tool calls were requested, the agent is done!
        if (pendingToolCalls.length === 0) {
          finished = true;
          break;
        }

        // Record assistant turn with tool calls
        messages.push({
          id: `asst_${Date.now()}_${stepCount}`,
          role: 'assistant',
          content: assistantText,
          toolCalls: pendingToolCalls,
          timestamp: Date.now()
        });

        // Execute each tool call
        for (const tc of pendingToolCalls) {
          if (this.abortController?.signal.aborted) {
            this.sendStatus(mainWindow, 'cancelled');
            return;
          }

          // Permission check
          const perm = permissionEngine.check(settings.permissionMode, tc);
          if (!perm.allowed) {
            this.sendEvent(mainWindow, {
              id: `perm_block_${Date.now()}`,
              type: 'error',
              title: 'Permission Blocked',
              content: perm.reason || 'Command blocked by security guardrails',
              timestamp: Date.now()
            });

            messages.push({
              id: `tool_block_${Date.now()}`,
              role: 'tool',
              toolCallId: tc.id,
              content: `Error: Execution denied by security guardrail: ${perm.reason}`,
              timestamp: Date.now()
            });
            continue;
          }

          // Emit tool start in timeline
          const eventId = `tc_${tc.id}`;
          this.sendEvent(mainWindow, {
            id: eventId,
            type: 'tool_call',
            title: `${tc.name}`,
            content: JSON.stringify(tc.args, null, 2),
            toolCall: tc,
            status: 'running',
            timestamp: Date.now()
          });

          // Execute tool
          const result = await toolRegistry.execute(tc, projectPath, (change) => {
            affectedFilesList.add(change.relativePath);
            this.sendFileChange(mainWindow, change);
          });

          // Emit result
          this.sendEvent(mainWindow, {
            id: `tr_${tc.id}`,
            type: 'tool_result',
            title: `${tc.name} Result`,
            content: result.success ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)) : `Error: ${result.error}`,
            toolResult: result,
            status: result.success ? 'success' : 'failed',
            timestamp: Date.now()
          });

          // Append tool result message
          messages.push({
            id: `tr_msg_${Date.now()}`,
            role: 'tool',
            toolCallId: tc.id,
            name: tc.name,
            content: result.success ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output)) : `Tool Error: ${result.error}`,
            timestamp: Date.now()
          });
        }
      } catch (err: any) {
        if (this.abortController?.signal.aborted) {
          this.sendStatus(mainWindow, 'cancelled');
          return;
        }
        this.sendEvent(mainWindow, {
          id: `step_err_${Date.now()}`,
          type: 'error',
          title: 'Execution Error',
          content: err.message || 'Agent error during step execution.',
          timestamp: Date.now()
        });
        this.sendStatus(mainWindow, 'failed');
        return;
      }
    }

    // Update todos to completed
    liveTodos[1].status = 'completed';
    liveTodos[2].status = 'completed';
    liveTodos[3].status = 'completed';
    this.sendTodos(mainWindow, liveTodos);

    // Calculate usage & cost
    const modelConfig = appStore.getProviders().flatMap((p) => p.models).find((m) => m.id === settings.activeModelId);
    const inPrice = modelConfig?.inputPricePerMillion ?? 0.5;
    const outPrice = modelConfig?.outputPricePerMillion ?? 2.0;
    const cost = (totalPromptTokens * inPrice + totalCompletionTokens * outPrice) / 1000000;

    appStore.saveUsage({
      inputTokens: totalPromptTokens,
      outputTokens: totalCompletionTokens,
      estimatedCost: cost,
      providerId: settings.activeProviderId,
      modelId: settings.activeModelId,
      timestamp: Date.now()
    });

    // Send final completion summary per Section 88
    const summaryText = settings.language === 'th'
      ? `### ดำเนินการเสร็จสมบูรณ์\n\n**ไฟล์ที่แก้ไข:**\n${Array.from(affectedFilesList).map((f) => `- ${f}`).join('\n') || '- ไม่มีการแก้ไขไฟล์'}\n\n**การใช้ทรัพยากร:**\n- Tokens: Input ${totalPromptTokens.toLocaleString()}, Output ${totalCompletionTokens.toLocaleString()}\n- ค่าใช้จ่ายประมาณการ: $${cost.toFixed(4)}`
      : `### Task Completed\n\n**Changed files:**\n${Array.from(affectedFilesList).map((f) => `- ${f}`).join('\n') || '- No files modified'}\n\n**Usage:**\n- Tokens: Input ${totalPromptTokens.toLocaleString()}, Output ${totalCompletionTokens.toLocaleString()}\n- Estimated Cost: $${cost.toFixed(4)}`;

    this.sendEvent(mainWindow, {
      id: `summary_${Date.now()}`,
      type: 'summary',
      title: settings.language === 'th' ? 'สรุปผลการทำงาน (Summary)' : 'Completion Summary',
      content: summaryText,
      timestamp: Date.now()
    });

    this.sendStatus(mainWindow, 'completed');
  }
}

export const agentRuntime = new AgentRuntime();
