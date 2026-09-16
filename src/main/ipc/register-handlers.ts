import { dialog, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import { fileService } from '../filesystem/file-service';
import { terminalService } from '../terminal/terminal-service';
import { gitService } from '../git/git-service';
import { appStore } from '../database/store';
import { providerManager } from '../ai/providers/provider-manager';
import { agentRuntime } from '../ai/agent/agent-runtime';
import { SkillItem, McpServerConfig } from '../../shared/types';

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Window controls
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow.close();
  });

  // Project opening & filesystem
  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN_DIALOG, async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    if (res.canceled || res.filePaths.length === 0) {
      return null;
    }
    const dir = res.filePaths[0];
    const settings = appStore.getSettings();
    const recents = Array.from(new Set([dir, ...settings.recentProjects])).slice(0, 10);
    appStore.saveSettings({ recentProjects: recents });
    return dir;
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_TREE, async (_event, projectPath: string) => {
    if (!projectPath || !fs.existsSync(projectPath)) return null;
    return fileService.getTree(projectPath);
  });

  ipcMain.handle(IPC_CHANNELS.FILE_READ, async (_event, filePath: string) => {
    return fileService.readFile(filePath);
  });

  ipcMain.handle(IPC_CHANNELS.FILE_WRITE, async (_event, filePath: string, content: string) => {
    fileService.writeFile(filePath, content);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.FILE_CREATE, async (_event, filePath: string, content: string) => {
    fileService.createFile(filePath, content);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, filePath: string) => {
    fileService.deleteFile(filePath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.FILE_RENAME, async (_event, oldPath: string, newPath: string) => {
    fileService.renameFile(oldPath, newPath);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.FILE_SEARCH, async (_event, rootDir: string, query: string) => {
    return fileService.searchFiles(rootDir, query);
  });

  ipcMain.handle(IPC_CHANNELS.FILE_GREP, async (_event, rootDir: string, query: string) => {
    return fileService.grep(rootDir, query);
  });

  // Git
  ipcMain.handle(IPC_CHANNELS.GIT_STATUS, async (_event, cwd: string) => {
    return await gitService.getStatus(cwd);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_DIFF, async (_event, cwd: string, filePath?: string) => {
    return await gitService.getDiff(cwd, filePath);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_LOG, async (_event, cwd: string, limit?: number) => {
    return await gitService.getLog(cwd, limit);
  });

  ipcMain.handle(IPC_CHANNELS.GIT_COMMIT, async (_event, cwd: string, message: string) => {
    return await gitService.commit(cwd, message);
  });

  // Terminal
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CREATE, (_event, id: string, cwd: string, shellType?: string) => {
    terminalService.createTerminal(id, cwd, mainWindow, shellType);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, id: string, data: string) => {
    terminalService.write(id, data);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_KILL, (_event, id: string) => {
    terminalService.killTerminal(id);
    return true;
  });

  // Settings & Storage
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return appStore.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, (_event, update: any) => {
    return appStore.saveSettings(update);
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_GET, () => {
    return appStore.getProviders();
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_SAVE, (_event, providers: any) => {
    appStore.saveProviders(providers);
    providerManager.reloadProviders();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.PROVIDERS_TEST, async (_event, providerId: string, apiKey?: string, baseUrl?: string, model?: string) => {
    return await providerManager.testConnection(providerId, apiKey, baseUrl, model);
  });

  // Checkpoints
  ipcMain.handle(IPC_CHANNELS.CHECKPOINTS_LIST, () => {
    return appStore.getCheckpoints();
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_CREATE, (_event, description: string, files: any[]) => {
    const id = `cp_${Date.now()}`;
    const cp = { id, timestamp: Date.now(), description, files };
    appStore.saveCheckpoint(cp);
    return cp;
  });

  ipcMain.handle(IPC_CHANNELS.CHECKPOINT_RESTORE, (_event, id: string) => {
    const cp = appStore.getCheckpointById(id);
    if (!cp) return false;
    for (const f of cp.files) {
      try {
        fileService.writeFile(f.path, f.content);
      } catch (e) {
        console.error('Failed restoring file:', f.path, e);
      }
    }
    return true;
  });

  // Agent Actions
  ipcMain.handle(IPC_CHANNELS.AGENT_START, async (_event, args: { prompt: string; mode: any; projectPath: string; conversationHistory?: any[] }) => {
    // Run asynchronously in background, sending events via webContents
    agentRuntime.run(mainWindow, args.prompt, args.mode, args.projectPath, args.conversationHistory || []);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_CANCEL, () => {
    agentRuntime.cancel();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_APPROVE_PLAN, () => {
    agentRuntime.approvePlan();
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.AGENT_REJECT_PLAN, () => {
    agentRuntime.rejectPlan();
    return true;
  });

  // Skills
  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, (_event, projectPath?: string) => {
    const skills: SkillItem[] = [
      { id: 'review', name: 'review', description: 'Review git diff for bugs & regressions', content: 'Review the current git diff and report potential bugs, security issues, and type errors.', isGlobal: true },
      { id: 'test', name: 'test', description: 'Run test suite and fix failures', content: 'Run test suite, identify failing tests, and fix them cleanly.', isGlobal: true },
      { id: 'simplify', name: 'simplify', description: 'Refactor code to be cleaner and simpler', content: 'Simplify complex functions, remove duplicate logic, and improve readability.', isGlobal: true },
      { id: 'commit', name: 'commit', description: 'Generate conventional commit message', content: 'Analyze git diff and draft a concise conventional commit message.', isGlobal: true },
      { id: 'open-pr', name: 'open-pr', description: 'Prepare pull request title and description', content: 'Summarize branch changes and format a comprehensive PR description.', isGlobal: true }
    ];

    // Check project skills .d4ide/skills/
    if (projectPath) {
      const pSkillsDir = path.join(projectPath, '.d4ide', 'skills');
      if (fs.existsSync(pSkillsDir)) {
        try {
          const files = fs.readdirSync(pSkillsDir).filter((f) => f.endsWith('.md'));
          for (const f of files) {
            const id = path.basename(f, '.md');
            const content = fs.readFileSync(path.join(pSkillsDir, f), 'utf8');
            skills.push({
              id,
              name: id,
              description: `Project skill: ${id}`,
              content,
              isGlobal: false
            });
          }
        } catch {}
      }
    }
    return skills;
  });

  // MCP Servers
  ipcMain.handle(IPC_CHANNELS.MCP_LIST, (_event, projectPath?: string) => {
    const servers: McpServerConfig[] = [];
    if (projectPath) {
      const mcpFile = path.join(projectPath, '.d4ide', 'mcp.json');
      if (fs.existsSync(mcpFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
          if (Array.isArray(data.servers)) {
            return data.servers;
          }
        } catch {}
      }
    }
    return servers;
  });

  // Preview screenshot
  ipcMain.handle(IPC_CHANNELS.PREVIEW_CAPTURE, async () => {
    try {
      const image = await mainWindow.webContents.capturePage();
      return image.toDataURL();
    } catch {
      return null;
    }
  });
}
