import { dialog, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import { fileService } from '../filesystem/file-service';
import { fileWatcher } from '../filesystem/file-watcher';
import { terminalService } from '../terminal/terminal-service';
import { gitService } from '../git/git-service';
import { appStore } from '../database/store';
import { providerManager } from '../ai/providers/provider-manager';
import { agentRuntime } from '../ai/agent/agent-runtime';
import { usageService } from '../ai/usage/usage-service';
import { mcpClient } from '../mcp/mcp-client';
import { normalizeMcpConfig } from '../mcp/mcp-transport';
import { toolRegistry } from '../ai/tools/tool-registry';
import { logService, LOG_CHANNELS } from '../logging/log-service';
import { notificationService } from '../notifications/notification-service';
import { updateService } from '../updater/update-service';
import { catalogRefreshService } from '../ai/providers/catalog-refresh';
import { describeRefusals, planCheckpointRestore } from '../checkpoints/checkpoint-policy';
import { builtinCommandSkills } from '../../shared/builtin-commands';
import { inspectProjectDatabase } from '../project/database-evidence';
import { AuthProvider, AuthService } from '../auth/auth-service';
import { previewRegistry } from '../preview/preview-registry';
import { readProjectMemory, writeProjectMemory, memorySkeleton } from '../project/project-memory';
import { ProjectDesign, readProjectDesign, writeProjectDesign } from '../project/design-store';
import { DesignStyle } from '../../shared/design-profiles';
import {
  BufferSnapshot,
  LogChannel,
  LogLevel,
  Mission,
  PlanScope,
  PlanStepDecision,
  SkillItem,
  McpServerConfig,
  ProviderConfig,
  SessionTranscript
} from '../../shared/types';

const DEV_SERVER_PORTS = [3000, 3001, 4200, 5000, 5173, 5174, 8000, 8080, 8888, 4321];

/** Image types the UI may inline, and the biggest one it will accept. */
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

async function probePort(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 400);
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal, redirect: 'manual' });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Background terminals (the agent's dev servers) report into this window, and
  // every terminal's output is watched for the address a server bound to.
  terminalService.attachWindow(mainWindow);
  terminalService.onOutput((text, terminalId) => {
    const discovered = previewRegistry.observe(text, terminalId);
    for (const server of discovered) {
      if (mainWindow.isDestroyed()) break;
      mainWindow.webContents.send(IPC_CHANNELS.PREVIEW_DISCOVERED, { url: server.url, source: server.source });
      logService.info('app', 'Preview address discovered', { url: server.url, source: server.source });
    }
  });
  // One sign-in state for the whole process. Built here rather than at import
  // time: this runs after `app.whenReady()`, which is when encrypted storage
  // becomes usable.
  const authService = new AuthService(appStore.getDataDir());

  // -------------------------------------------------------- window controls
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => mainWindow.minimize());
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => mainWindow.close());

  // ----------------------------------------------------- project & filesystem
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN_DIALOG, async () => {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    const dir = res.filePaths[0];
    const settings = appStore.getSettings();
    appStore.saveSettings({ recentProjects: Array.from(new Set([dir, ...settings.recentProjects])).slice(0, 10) });
    return dir;
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN_PATH, (_event, projectPath: string) => {
    if (!projectPath || !fs.existsSync(projectPath)) return false;
    const settings = appStore.getSettings();
    appStore.saveSettings({ recentProjects: Array.from(new Set([projectPath, ...settings.recentProjects])).slice(0, 10) });
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_RECENT_LIST, () => appStore.getSettings().recentProjects);

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_TREE, (_event, projectPath: string) => {
    if (!projectPath || !fs.existsSync(projectPath)) return null;
    return fileService.getTree(projectPath);
  });

  // What the project stores its data in. Falls back to the most recently opened
  // project so the panel still has something to show when the renderer is not
  // sure which folder it is looking at.
  ipcMain.handle(IPC_CHANNELS.PROJECT_DATABASE, (_event, projectPath?: string) => {
    const target = projectPath || appStore.getSettings().recentProjects?.[0];
    if (!target || !fs.existsSync(target)) return { scanned: [], databases: [], tooling: [] };
    try {
      return inspectProjectDatabase(target);
    } catch (error) {
      logService.warn('app', 'Project database inspection failed', { target, error: String(error) });
      return { scanned: [], databases: [], tooling: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILE_READ, (_event, filePath: string) => fileService.readFile(filePath));
  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, (_event, filePath: string, content: string) => {
    fileService.writeFile(filePath, content);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.FILE_CREATE, (_event, filePath: string, content: string) => {
    fileService.createFile(filePath, content);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, (_event, filePath: string) => {
    fileService.deleteFile(filePath);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, (_event, oldPath: string, newPath: string) => {
    fileService.renameFile(oldPath, newPath);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.FILE_SEARCH, (_event, rootDir: string, query: string) =>
    fileService.searchFiles(rootDir, query)
  );
  ipcMain.handle(IPC_CHANNELS.FILE_GREP, (_event, rootDir: string, query: string) =>
    fileService.grep(rootDir, query)
  );

  // Renders an image from inside the project (agent screenshots) in the UI. The
  // renderer cannot read files itself, so the path is validated here: it must
  // resolve inside the given project root and be a real image type.
  ipcMain.handle(
    IPC_CHANNELS.FILE_READ_DATA_URL,
    (_event, projectPath: string, relativePath: string): string | null => {
      try {
        if (!projectPath || !relativePath) return null;
        const root = path.resolve(projectPath);
        const full = path.resolve(root, relativePath);
        if (full !== root && !full.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) return null;

        const mime = IMAGE_MIME_BY_EXTENSION[path.extname(full).toLowerCase()];
        if (!mime) return null;

        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > MAX_INLINE_IMAGE_BYTES) return null;
        return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
      } catch {
        return null;
      }
    }
  );

  // External-change watcher (spec §48).
  ipcMain.handle(IPC_CHANNELS.FILE_WATCH_START, (_event, rootDir: string) => {
    const started = fileWatcher.start(rootDir, (events) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.FILE_CHANGED, events);
      }
    });
    return started;
  });

  ipcMain.handle(IPC_CHANNELS.FILE_WATCH_STOP, () => {
    fileWatcher.stop();
    return true;
  });

  // ------------------------------------------------------------------- git
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, (_event, cwd: string) => gitService.getStatus(cwd));
  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, (_event, cwd: string, filePath?: string, staged?: boolean) =>
    gitService.getDiff(cwd, filePath, staged)
  );
  ipcMain.handle(IPC_CHANNELS.GIT_LOG, (_event, cwd: string, limit?: number) => gitService.getLog(cwd, limit));
  ipcMain.handle(IPC_CHANNELS.GIT_BRANCHES, (_event, cwd: string) => gitService.getBranches(cwd));
  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, (_event, cwd: string, message: string) => gitService.commit(cwd, message));

  // -------------------------------------------------------------- terminal
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, (_event, id: string, cwd: string, shellType?: string) => {
    terminalService.createTerminal(id, cwd, mainWindow, shellType);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, id: string, data: string) => {
    terminalService.write(id, data);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, id: string, cols: number, rows: number) => {
    terminalService.resize(id, cols, rows);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.TERMINAL_KILL, (_event, id: string) => {
    terminalService.killTerminal(id);
    return true;
  });
  // The renderer says which terminals are on screen. Until it does, main does
  // not ship their output at all: a chunk cloned across the process boundary
  // for a panel that does not exist is pure cost, and a flood made that visible
  // (39,803 messages and 8.3 CPU seconds to move 497 KB).
  ipcMain.handle(IPC_CHANNELS.TERMINAL_WATCH, (_event, id: string, watching: boolean) => {
    terminalService.watchTerminal(id, watching !== false);
    return true;
  });

  // -------------------------------------------------------------- settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => appStore.getSettings());
  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_event, update: any) => {
    const before = appStore.getSettings();
    const settings = appStore.saveSettings(update);
    // Switching to Full means "stop asking": an approval dialog that is already
    // on screen would otherwise block a run the user just freed. Turning the
    // gate on again never auto-answers anything.
    if (settings.permissionMode === 'full' && before.permissionMode !== 'full') {
      agentRuntime.approveAllPending('approved', mainWindow);
    }
    if (
      settings.catalogCheckEnabled !== before.catalogCheckEnabled ||
      settings.catalogCheckIntervalHours !== before.catalogCheckIntervalHours
    ) {
      catalogRefreshService.reconfigure();
    }
    if (settings.permissionMode !== before.permissionMode) {
      logService.info('app', 'Permission mode changed', {
        from: before.permissionMode,
        to: settings.permissionMode
      });
    }
    // The update switches are read when a check is scheduled, so a change has to
    // be pushed rather than waited for — turning checking off must cancel the
    // timer that is already running, not the next one.
    if (
      settings.updateCheckEnabled !== before.updateCheckEnabled ||
      settings.checkUpdatesOnLaunch !== before.checkUpdatesOnLaunch ||
      settings.updateCheckIntervalHours !== before.updateCheckIntervalHours
    ) {
      updateService.reconfigure();
    }
    return settings;
  });

  // ------------------------------------------------------------- providers
  // Sanitized: the renderer never receives a plaintext API key (spec §29).
  ipcMain.handle(IPC_CHANNELS.PROVIDERS_GET, (): ProviderConfig[] => appStore.getSanitizedProviders());

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_SAVE, (_event, providers: ProviderConfig[]) => {
    const incoming = providers.map((p) => {
      const existing = appStore.getProviders().find((x) => x.id === p.id);
      const apiKey = p.apiKey !== undefined && p.apiKey !== '' ? p.apiKey : existing?.apiKey ?? '';
      return { ...p, apiKey };
    });
    appStore.saveProviders(incoming);
    providerManager.reloadProviders();
    return appStore.getSanitizedProviders();
  });

  ipcMain.handle(
    IPC_CHANNELS.PROVIDERS_TEST,
    async (_event, providerId: string, apiKey?: string, baseUrl?: string, model?: string) => {
      const result = await providerManager.testConnection(providerId, apiKey, baseUrl, model);
      return { result, providers: appStore.getSanitizedProviders() };
    }
  );

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_REFRESH_MODELS, async (_event, providerId: string) => {
    const res = await providerManager.refreshModels(providerId);
    return { ...res, providers: appStore.getSanitizedProviders() };
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_SET_KEY, (_event, providerId: string, apiKey: string | null) => {
    appStore.setProviderKey(providerId, apiKey);
    providerManager.reloadProviders();
    return appStore.getSanitizedProviders();
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_DELETE, (_event, providerId: string) => {
    appStore.deleteProvider(providerId);
    providerManager.reloadProviders();
    return appStore.getSanitizedProviders();
  });

  ipcMain.handle(IPC_CHANNELS.MODELS_RESOLVE_AUTO, (_event, profile: 'quality' | 'balanced' | 'cost' | 'fast') =>
    providerManager.resolveAutoModel(profile)
  );

  // ----------------------------------------------------------- usage & cost
  ipcMain.handle(IPC_CHANNELS.USAGE_GET, () => usageService.summary(agentRuntime.getSessionId() || null));
  ipcMain.handle(IPC_CHANNELS.USAGE_RESET, (_event, fromTimestamp?: number) => {
    appStore.clearUsage(fromTimestamp || 0);
    return usageService.summary(agentRuntime.getSessionId() || null);
  });

  // -------------------------------------------------------------- sessions
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, () => appStore.getSessions());
  ipcMain.handle(IPC_CHANNELS.SESSION_UPSERT, (_event, session: any) => appStore.upsertSession(session));
  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, (_event, sessionId: string) => {
    appStore.deleteSession(sessionId);
    return true;
  });
  // Replays a stored run in the agent view and lets the model continue it (§84).
  ipcMain.handle(IPC_CHANNELS.SESSION_TRANSCRIPT_GET, (_event, sessionId: string) =>
    appStore.getSessionTranscript<SessionTranscript>(sessionId)
  );

  // ------------------------------------------------------------ checkpoints
  ipcMain.handle(IPC_CHANNELS.CHECKPOINTS_LIST, () =>
    appStore.getCheckpoints().map((c) => ({
      id: c.id,
      timestamp: c.timestamp,
      description: c.description,
      files: c.files.map((f) => ({ path: f.path, content: '' }))
    }))
  );

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_CREATE, (_event, description: string, files: { path: string; content: string }[]) => {
    const cp = {
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      description,
      files: files || []
    };
    appStore.saveCheckpoint(cp);
    return cp;
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_RESTORE, (_event, id: string, projectPath?: string) => {
    const cp = appStore.getCheckpointById(id);
    if (!cp) return { success: false, error: 'Checkpoint not found' };
    if (cp.files.length === 0) {
      return { success: false, error: 'This checkpoint holds no file snapshots to restore.' };
    }

    // Snapshots are absolute paths captured in an earlier session, so they are
    // only written back when they still resolve inside the project open now.
    const plan = planCheckpointRestore(cp.files, projectPath ?? '');
    let restored = 0;
    for (const f of plan.writable) {
      try {
        fileService.writeFile(f.path, f.content);
        restored++;
      } catch (e: any) {
        console.error('Failed restoring file:', f.path, e);
      }
    }

    if (restored === 0 && plan.refused.length > 0) {
      return { success: false, error: describeRefusals(plan.refused), restored, total: cp.files.length, refused: plan.refused };
    }
    return { success: restored > 0, restored, total: cp.files.length, refused: plan.refused };
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_DELETE, (_event, id: string) => {
    appStore.deleteCheckpoint(id);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.TOOL_AUDIT_LIST, (_event, limit?: number) => appStore.getToolAudit(limit ?? 200));

  // ----------------------------------------------------------------- agent
  ipcMain.handle(
    IPC_CHANNELS.AGENT_START,
    async (
      _event,
      args: {
        prompt: string;
        mode: any;
        projectPath: string;
        conversationHistory?: any[];
        sessionId?: string;
        images?: any[];
      }
    ) => {
      // The updater never restarts the app mid-task (spec §83).
      updateService.setAgentBusy(true);
      catalogRefreshService.setAgentBusy(true);
      agentRuntime.run(mainWindow, args).finally(() => {
        updateService.setAgentBusy(false);
        catalogRefreshService.setAgentBusy(false);
      });
      return true;
    }
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_CANCEL, () => {
    agentRuntime.cancel();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.AGENT_APPROVE_PLAN, (_event, scope: PlanScope = 'full') => {
    agentRuntime.approvePlan(scope);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.AGENT_REJECT_PLAN, () => {
    agentRuntime.rejectPlan();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.AGENT_REVISE_PLAN, (_event, feedback: string) => {
    agentRuntime.revisePlan(feedback);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.AGENT_CHOOSE_DESIGN, (_event, style: Exclude<DesignStyle, 'ask'>) =>
    agentRuntime.chooseDesignStyle(style)
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_PLAN_STEP, (_event, decision: PlanStepDecision) =>
    agentRuntime.resolvePlanStep(decision)
  );
  ipcMain.handle(
    IPC_CHANNELS.AGENT_APPROVAL_RESOLVE,
    (_event, id: string, decision: 'approved' | 'approved_for_session' | 'rejected', toolName?: string) =>
      agentRuntime.resolveApproval(id, decision, toolName)
  );
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_STATE, () => agentRuntime.getSessionState());

  // --------------------------------------------------------------- sign-in
  const authOptions = () => {
    const settings = appStore.getSettings();
    return {
      required: settings.requireLogin !== false,
      githubClientId: settings.githubClientId,
      googleClientId: settings.googleClientId
    };
  };

  ipcMain.handle(IPC_CHANNELS.AUTH_STATUS, async () => {
    // A stored session is re-checked before the app unlocks: a token that was
    // revoked (or expired) must not keep the gate open.
    if (authService.hasSession()) {
      const verified = await authService.verify();
      if (!verified.signedIn) return authService.getState(authOptions());
    }
    return authService.getState(authOptions());
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SIGN_IN, async (event, provider: AuthProvider) => {
    const options = authOptions();
    try {
      if (provider === 'github') {
        if (!options.githubClientId) return { success: false, error: 'no-client-id' };
        const profile = await authService.signInWithGithub(options.githubClientId, (prompt) => {
          event.sender.send(IPC_CHANNELS.AUTH_DEVICE_PROMPT, prompt);
        });
        logService.info('app', 'Signed in with GitHub', { login: profile.login });
        return { success: true, profile, state: authService.getState(authOptions()) };
      }

      if (provider === 'google') {
        if (!options.googleClientId) return { success: false, error: 'no-client-id' };
        const profile = await authService.signInWithGoogle(options.googleClientId, (url) => {
          event.sender.send(IPC_CHANNELS.AUTH_DEVICE_PROMPT, { verificationUri: url, browserOpened: true });
        });
        logService.info('app', 'Signed in with Google', { email: profile.email });
        return { success: true, profile, state: authService.getState(authOptions()) };
      }

      return { success: false, error: 'unsupported-provider' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logService.warn('app', 'Sign-in failed', { provider, message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SIGN_OUT, () => {
    authService.signOut();
    logService.info('app', 'Signed out');
    return true;
  });

  // ---------------------------------------------------------------- skills

  /** Reads `<dir>/*.md` as skills; a directory that is not there is simply empty. */
  const readSkillDirectory = (dir: string, isGlobal: boolean): SkillItem[] => {
    if (!fs.existsSync(dir)) return [];
    try {
      return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => {
          const id = path.basename(file, '.md');
          const content = fs.readFileSync(path.join(dir, file), 'utf8');
          const firstLine =
            content.split('\n').find((line) => line.trim() && !line.startsWith('#')) || `Skill: ${id}`;
          return { id, name: id, description: firstLine.trim().slice(0, 120), content, isGlobal };
        });
    } catch (e) {
      console.error(`Failed reading skills from ${dir}:`, e);
      return [];
    }
  };

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, (_event, projectPath?: string) => {
    // The shipped command set is always present, described in the UI language.
    const language = appStore.getSettings().language === 'en' ? 'en' : 'th';
    const skills = builtinCommandSkills(language);

    const upsert = (skill: SkillItem) => {
      const existing = skills.findIndex((entry) => entry.id === skill.id);
      if (existing >= 0) skills[existing] = skill;
      else skills.push(skill);
    };

    // A user skill with the same name replaces the shipped one, so anything
    // built in can be overridden or dropped without touching the app.
    for (const skill of readSkillDirectory(path.join(appStore.getDataDir(), 'skills'), true)) upsert(skill);
    if (projectPath) {
      for (const skill of readSkillDirectory(path.join(projectPath, '.d4ide', 'skills'), false)) upsert(skill);
    }

    return skills;
  });

  ipcMain.handle(IPC_CHANNELS.SKILLS_SAVE, (_event, skill: SkillItem, projectPath?: string) => {
    // With no project open there is still somewhere to save: the user's own
    // data folder. Refusing to save at all made the button look broken.
    const skillsDir = projectPath
      ? path.join(projectPath, '.d4ide', 'skills')
      : path.join(appStore.getDataDir(), 'skills');
    try {
      if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
      fs.writeFileSync(path.join(skillsDir, `${skill.id}.md`), skill.content, 'utf8');
      return { success: true, path: path.join(skillsDir, `${skill.id}.md`), scope: projectPath ? 'project' : 'global' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, (_event, skillId: string, projectPath?: string) => {
    const dir = projectPath
      ? path.join(projectPath, '.d4ide', 'skills')
      : path.join(appStore.getDataDir(), 'skills');
    const file = path.join(dir, `${skillId}.md`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { success: true };
  });

  // ------------------------------------------------------------------- MCP
  ipcMain.handle(IPC_CHANNELS.MCP_LIST, (_event, projectPath?: string) => {
    const fromProject: McpServerConfig[] = [];
    if (projectPath) {
      const mcpFile = path.join(projectPath, '.d4ide', 'mcp.json');
      if (fs.existsSync(mcpFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
          const list = Array.isArray(data?.servers) ? data.servers : Array.isArray(data) ? data : [];
          for (const server of list) {
            // stdio, HTTP or a preset-shaped entry — one normaliser decides.
            const normalized = normalizeMcpConfig(server);
            if (!normalized) {
              console.warn('Skipping unusable .d4ide/mcp.json entry:', server?.id ?? server?.name ?? '(unnamed)');
              continue;
            }
            fromProject.push(normalized);
          }
        } catch (e) {
          console.error('Failed reading .d4ide/mcp.json:', e);
        }
      }
    }

    const live = new Map(mcpClient.list().map((s) => [s.id, s]));
    return fromProject.map((s) => ({ ...s, status: live.get(s.id)?.status ?? s.status, error: live.get(s.id)?.error }));
  });

  ipcMain.handle(IPC_CHANNELS.MCP_DISCOVERED, () => mcpClient.toolsByServer());

  // Health is: is it connected, how many tools did it announce, and when did it
  // last say anything? A connected server that has gone quiet is worth showing.
  ipcMain.handle(IPC_CHANNELS.MCP_HEALTH, (_event, serverId: string) => mcpClient.health(serverId));

  ipcMain.handle(IPC_CHANNELS.MCP_REFRESH_TOOLS, async (_event, serverId: string) => {
    const tools = await mcpClient.refreshTools(serverId);
    if (tools.length) toolRegistry.registerMcpTools(tools);
    return { tools: tools.length, servers: mcpClient.list() };
  });

  ipcMain.handle(IPC_CHANNELS.MCP_START, async (_event, config: McpServerConfig, cwd?: string) => {
    const res = await mcpClient.start(config, cwd);
    // Make the discovered tools callable by the agent (spec §42).
    if (res.success && res.tools) toolRegistry.registerMcpTools(res.tools);
    return { ...res, servers: mcpClient.list() };
  });

  ipcMain.handle(IPC_CHANNELS.MCP_STOP, async (_event, serverId: string) => {
    await mcpClient.stop(serverId);
    toolRegistry.unregisterMcpTools(serverId);
    return mcpClient.list();
  });

  ipcMain.handle(IPC_CHANNELS.MCP_CALL, (_event, serverId: string, toolName: string, args: any) =>
    mcpClient.callTool(serverId, toolName, args || {})
  );

  // --------------------------------------------------------------- preview
  ipcMain.handle(IPC_CHANNELS.PREVIEW_CAPTURE, async () => {
    try {
      const image = await mainWindow.webContents.capturePage();
      return image.toDataURL();
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PREVIEW_DETECT, async (_event, projectPath?: string) => {
    // Addresses the servers themselves printed come first: they are the truth,
    // while everything below is a guess that can easily be wrong.
    const candidates = new Set<string>(previewRegistry.urls());
    for (const port of DEV_SERVER_PORTS) candidates.add(`http://localhost:${port}`);

    if (projectPath) {
      const pkgFile = path.join(projectPath, 'package.json');
      try {
        if (fs.existsSync(pkgFile)) {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
          const scripts: Record<string, string> = pkg.scripts || {};
          for (const [name, command] of Object.entries(scripts)) {
            if (!/^(dev|start|serve|preview)/.test(name)) continue;
            const portMatch = command.match(/(?:--port|-p)\s+(\d{2,5})/) || command.match(/:(\d{4,5})/);
            if (portMatch) {
              candidates.add(`http://localhost:${portMatch[1]}`);
              candidates.add(`http://127.0.0.1:${portMatch[1]}`);
            }
          }
        }
      } catch {
        // No readable package.json — fall back to probing.
      }
    }

    const remembered = previewRegistry.list();
    const live = new Map<string, boolean>();
    await Promise.all(
      Array.from(candidates).map(async (url) => live.set(url, await probePort(Number(new URL(url).port))))
    );

    // A server that printed its address and answers is the answer. Anything
    // that is only a guess and does not answer is not listed at all — a row of
    // dead ports is what made the panel look broken rather than empty.
    const liveRemembered = remembered.filter((server) => live.get(server.url)).map((server) => server.url);
    const liveGuessed = Array.from(candidates)
      .filter((url) => live.get(url) && !liveRemembered.includes(url))
      .sort((a, b) => a.localeCompare(b));
    // Still booting counts: the panel should open while the server starts.
    const booting = remembered
      .filter((server) => !live.get(server.url) && Date.now() - server.seenAt < 120_000)
      .map((server) => server.url);

    return Array.from(new Set([...liveRemembered, ...liveGuessed, ...booting]));
  });

  ipcMain.handle('storage:info', () => appStore.getStorageInfo());

  // ------------------------------------------------------- database upkeep
  ipcMain.handle('db:info', () => appStore.getDatabaseInfo());
  ipcMain.handle('db:check', (_event, full = false) => {
    const result = appStore.checkDatabase(!!full);
    logService.info('app', full ? 'Database integrity check' : 'Database quick check', {
      ok: result.ok,
      problems: result.problems.slice(0, 5)
    });
    return result;
  });
  ipcMain.handle('db:backup', () => {
    const file = appStore.backupDatabase();
    logService.info('app', file ? 'Database backup created' : 'Database backup failed', { file });
    return file;
  });
  ipcMain.handle('db:vacuum', () => {
    const sizes = appStore.vacuumDatabase();
    logService.info('app', 'Database compacted', sizes ?? undefined);
    return sizes;
  });
  ipcMain.handle('db:open-folder', async (_event, which: 'data' | 'backups' = 'data') => {
    const info = appStore.getDatabaseInfo();
    const dir = which === 'backups' && info ? path.join(info.dataDir, 'backups') : appStore.getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });

  // ---------------------------------------------------------------- mission
  ipcMain.handle(IPC_CHANNELS.MISSION_GET, (_event, sessionId: string) => appStore.getMission(sessionId));
  ipcMain.handle(IPC_CHANNELS.MISSION_SET, (_event, sessionId: string, mission: Mission | null) => {
    const saved = appStore.saveMission(sessionId, mission);
    logService.info('agent', 'Mission updated', { sessionId, effort: mission?.effort, cleared: !saved });
    return saved;
  });

  // ------------------------------------------- project memory & screen style
  ipcMain.handle(IPC_CHANNELS.PROJECT_MEMORY_GET, (_event, projectPath: string) => {
    if (!projectPath) return null;
    const memory = readProjectMemory(projectPath);
    // An empty project gets a skeleton to fill in, so the file exists before the
    // first run instead of being conjured after one.
    return memory.exists
      ? memory
      : { ...memory, content: memorySkeleton(projectPath, appStore.getSettings().language === 'en' ? 'en' : 'th') };
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_MEMORY_SAVE, (_event, projectPath: string, content: string) => {
    if (!projectPath) return null;
    const saved = writeProjectMemory(projectPath, content);
    logService.info('app', 'Project memory updated', { projectPath, chars: saved.content.length });
    return saved;
  });
  ipcMain.handle(IPC_CHANNELS.PROJECT_DESIGN_GET, (_event, projectPath: string) =>
    projectPath ? readProjectDesign(projectPath) : null
  );
  ipcMain.handle(IPC_CHANNELS.PROJECT_DESIGN_SAVE, (_event, projectPath: string, update: Partial<ProjectDesign>) => {
    if (!projectPath) return null;
    const saved = writeProjectDesign(projectPath, update || {});
    logService.info('app', 'Project screen style updated', { projectPath, style: saved.style });
    return saved;
  });

  // ------------------------------------------------------------------ logs
  ipcMain.handle(
    IPC_CHANNELS.LOGS_READ,
    (_event, options: { channel?: LogChannel; level?: LogLevel; limit?: number; search?: string } = {}) =>
      logService.read(options)
  );
  ipcMain.handle(IPC_CHANNELS.LOGS_COUNTS, () => logService.counts());
  ipcMain.handle(IPC_CHANNELS.LOGS_CLEAR, () => {
    logService.clear();
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.LOGS_SET_LEVEL, (_event, level: LogLevel) => {
    const settings = appStore.saveSettings({ logLevel: level });
    logService.setLevel(level);
    logService.info('app', 'Log level changed', { level });
    return settings;
  });
  ipcMain.handle(IPC_CHANNELS.LOGS_OPEN_DIR, async () => {
    const dir = logService.getLogDirectory();
    if (!dir) return false;
    await shell.openPath(dir);
    return true;
  });

  // --------------------------------------------------------- notifications
  ipcMain.handle(IPC_CHANNELS.APP_NOTIFY, (_event, request: { title: string; body?: string; kind?: any }) => {
    if (!appStore.getSettings().desktopNotifications) return false;
    return notificationService.show(request, () => mainWindow);
  });

  // ----------------------------------------------------- crash recovery: buffers
  ipcMain.handle(IPC_CHANNELS.BUFFERS_GET, () => appStore.getBuffers());
  ipcMain.handle(IPC_CHANNELS.BUFFERS_SAVE, (_event, buffers: BufferSnapshot[]) => {
    appStore.saveBuffers(Array.isArray(buffers) ? buffers : []);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.BUFFERS_CLEAR, () => {
    appStore.clearBuffers();
    return true;
  });

  // ------------------------------------------------- settings import/export
  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export D4IDE settings',
      defaultPath: 'd4ide-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;

    // Providers are exported *without* keys: the file is meant to be shareable.
    const providers = appStore.getProviders().map((provider) => ({ ...provider, apiKey: '', hasApiKey: false }));
    const payload = {
      kind: 'd4ide-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...appStore.getSettings(), recentProjects: [], removedProviderIds: [] },
      providers
    };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    logService.info('app', 'Settings exported', { file: path.basename(result.filePath) });
    return result.filePath;
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import D4IDE settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      if (raw?.kind !== 'd4ide-settings') return { ok: false, error: 'Not a D4IDE settings file.' };

      const incoming = raw.settings ?? {};
      delete incoming.recentProjects;
      // Credentials are never imported: a settings file must not carry keys.
      const settings = appStore.saveSettings(incoming);
      logService.setLevel(settings.logLevel);

      const providers = Array.isArray(raw.providers) ? raw.providers : [];
      if (providers.length > 0) {
        const existing = appStore.getProviders();
        const merged = providers.map((provider: ProviderConfig) => {
          const current = existing.find((entry) => entry.id === provider.id);
          return { ...provider, apiKey: current?.apiKey ?? '', requiresApiKey: provider.requiresApiKey !== false };
        });
        appStore.saveProviders([
          ...merged,
          ...existing.filter((entry) => !merged.some((imported: ProviderConfig) => imported.id === entry.id))
        ]);
        providerManager.reloadProviders();
      }

      logService.info('app', 'Settings imported', { file: path.basename(result.filePaths[0]) });
      return { ok: true, settings, providers: appStore.getProviders() };
    } catch (error) {
      logService.warn('app', 'Settings import failed', { error: (error as Error).message });
      return { ok: false, error: (error as Error).message };
    }
  });

  // ---------------------------------------------------------------- updates
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, () => updateService.check());
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, () => updateService.download());
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => updateService.install());
  ipcMain.handle(IPC_CHANNELS.UPDATE_SKIP, (_event, version: string) => updateService.skipVersion(version));
  ipcMain.handle(IPC_CHANNELS.UPDATE_STATUS, () => updateService.getStatus());

  // ------------------------------------------------------- model catalogue
  ipcMain.handle(IPC_CHANNELS.CATALOG_STATUS, () => catalogRefreshService.getStatus());
  ipcMain.handle(IPC_CHANNELS.CATALOG_CHECK, () => catalogRefreshService.check('manual'));
  ipcMain.handle(IPC_CHANNELS.CATALOG_APPLY, () => catalogRefreshService.apply());
  ipcMain.handle(IPC_CHANNELS.CATALOG_DISCARD, () => catalogRefreshService.discard());
  ipcMain.handle(IPC_CHANNELS.CATALOG_UNDO, () => catalogRefreshService.undo());

  logService.info('app', 'IPC handlers registered', { channels: LOG_CHANNELS.length + Object.keys(IPC_CHANNELS).length });
}
