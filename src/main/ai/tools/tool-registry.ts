import path from 'path';
import fs from 'fs';
import { fileService } from '../../filesystem/file-service';
import { terminalService } from '../../terminal/terminal-service';
import { gitService } from '../../git/git-service';
import { appStore } from '../../database/store';
import { ToolCall, ToolResult, FileChange } from '../../../shared/types';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (args: any, projectPath: string, onFileChange?: (change: FileChange) => void) => Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.register({
      name: 'read_file',
      description: 'Read the text content of a file in the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path to the file' }
        },
        required: ['path']
      },
      execute: async (args, projectPath) => {
        const fullPath = path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path);
        return fileService.readFile(fullPath);
      }
    });

    this.register({
      name: 'write_file',
      description: 'Write or completely overwrite a file with full content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path to the file' },
          content: { type: 'string', description: 'The complete content to write' }
        },
        required: ['path', 'content']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path);
        const relPath = path.relative(projectPath, fullPath);
        const exists = fs.existsSync(fullPath);
        const prevContent = exists ? fs.readFileSync(fullPath, 'utf8') : '';

        fileService.writeFile(fullPath, args.content);

        if (onFileChange) {
          onFileChange({
            path: fullPath,
            relativePath: relPath,
            type: exists ? 'modified' : 'created',
            previousContent: prevContent,
            newContent: args.content,
            additions: args.content.split('\n').length,
            deletions: prevContent ? prevContent.split('\n').length : 0
          });
        }
        return `Successfully wrote to ${relPath}`;
      }
    });

    this.register({
      name: 'edit_file',
      description: 'Perform a targeted replacement in a file (find targetContent and replace with replacementContent).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          targetContent: { type: 'string', description: 'The exact string snippet to find and replace' },
          replacementContent: { type: 'string', description: 'The new string snippet to substitute' }
        },
        required: ['path', 'targetContent', 'replacementContent']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path);
        const relPath = path.relative(projectPath, fullPath);
        const content = fileService.readFile(fullPath);

        if (!content.includes(args.targetContent)) {
          throw new Error(`targetContent not found in ${relPath}. Please make sure whitespace and line breaks match.`);
        }

        const newContent = content.replace(args.targetContent, args.replacementContent);
        fileService.writeFile(fullPath, newContent);

        if (onFileChange) {
          onFileChange({
            path: fullPath,
            relativePath: relPath,
            type: 'modified',
            previousContent: content,
            newContent,
            additions: args.replacementContent.split('\n').length,
            deletions: args.targetContent.split('\n').length
          });
        }
        return `Successfully updated ${relPath}`;
      }
    });

    this.register({
      name: 'create_file',
      description: 'Create a new file in the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Initial file content' }
        },
        required: ['path']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path);
        const relPath = path.relative(projectPath, fullPath);
        fileService.createFile(fullPath, args.content || '');

        if (onFileChange) {
          onFileChange({
            path: fullPath,
            relativePath: relPath,
            type: 'created',
            previousContent: '',
            newContent: args.content || '',
            additions: (args.content || '').split('\n').length,
            deletions: 0
          });
        }
        return `Created file ${relPath}`;
      }
    });

    this.register({
      name: 'delete_file',
      description: 'Delete a file from the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to delete' }
        },
        required: ['path']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path);
        const relPath = path.relative(projectPath, fullPath);
        const prevContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
        fileService.deleteFile(fullPath);

        if (onFileChange) {
          onFileChange({
            path: fullPath,
            relativePath: relPath,
            type: 'deleted',
            previousContent: prevContent,
            newContent: '',
            additions: 0,
            deletions: prevContent.split('\n').length
          });
        }
        return `Deleted ${relPath}`;
      }
    });

    this.register({
      name: 'list_directory',
      description: 'List subdirectories and files in a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project or absolute' }
        }
      },
      execute: async (args, projectPath) => {
        const fullPath = args.path ? (path.isAbsolute(args.path) ? args.path : path.join(projectPath, args.path)) : projectPath;
        const tree = fileService.getTree(fullPath, 2);
        return tree;
      }
    });

    this.register({
      name: 'search_files',
      description: 'Search for files matching a filename query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Filename or path snippet to search' }
        },
        required: ['query']
      },
      execute: async (args, projectPath) => {
        return fileService.searchFiles(projectPath, args.query);
      }
    });

    this.register({
      name: 'grep',
      description: 'Search across all project files for text occurrences.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search across files' }
        },
        required: ['query']
      },
      execute: async (args, projectPath) => {
        return fileService.grep(projectPath, args.query);
      }
    });

    this.register({
      name: 'run_terminal',
      description: 'Execute a shell command inside the project directory.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' }
        },
        required: ['command']
      },
      execute: async (args, projectPath) => {
        const res = await terminalService.runCommandOnce(args.command, projectPath);
        return res;
      }
    });

    this.register({
      name: 'run_tests',
      description: 'Run project tests (e.g., npm test, pnpm test, pytest).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Custom test command (defaults to pnpm test or npm test)' }
        }
      },
      execute: async (args, projectPath) => {
        const cmd = args.command || 'npm test';
        return await terminalService.runCommandOnce(cmd, projectPath);
      }
    });

    this.register({
      name: 'run_build',
      description: 'Run project build (e.g., npm run build, pnpm build).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Custom build command (defaults to npm run build)' }
        }
      },
      execute: async (args, projectPath) => {
        const cmd = args.command || 'npm run build';
        return await terminalService.runCommandOnce(cmd, projectPath);
      }
    });

    this.register({
      name: 'git_status',
      description: 'Get git status of current repository.',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, projectPath) => {
        return await gitService.getStatus(projectPath);
      }
    });

    this.register({
      name: 'git_diff',
      description: 'Inspect unstaged or staged git diff.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional specific file path' }
        }
      },
      execute: async (args, projectPath) => {
        return await gitService.getDiff(projectPath, args.filePath);
      }
    });

    this.register({
      name: 'git_commit',
      description: 'Stage all modified files and commit with a message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' }
        },
        required: ['message']
      },
      execute: async (args, projectPath) => {
        return await gitService.commit(projectPath, args.message);
      }
    });

    this.register({
      name: 'create_checkpoint',
      description: 'Save a snapshot of project state that can be restored if needed.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Checkpoint description' }
        },
        required: ['description']
      },
      execute: async (args, projectPath) => {
        const id = `cp_${Date.now()}`;
        // Record recent files
        appStore.saveCheckpoint({
          id,
          timestamp: Date.now(),
          description: args.description,
          files: []
        });
        return { checkpointId: id, message: 'Checkpoint created successfully' };
      }
    });
  }

  register(def: ToolDefinition) {
    this.tools.set(def.name, def);
  }

  getToolDefinitions(mode: 'plan' | 'build') {
    const list: { name: string; description: string; parameters: Record<string, any> }[] = [];
    for (const [name, tool] of this.tools.entries()) {
      if (mode === 'plan') {
        // In plan mode, exclude write tools
        if (['write_file', 'edit_file', 'create_file', 'delete_file', 'git_commit'].includes(name)) {
          continue;
        }
      }
      list.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      });
    }
    return list;
  }

  async execute(toolCall: ToolCall, projectPath: string, onFileChange?: (change: FileChange) => void): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: `Unknown tool: ${toolCall.name}`
      };
    }

    try {
      const output = await tool.execute(toolCall.args, projectPath, onFileChange);
      return {
        toolCallId: toolCall.id,
        success: true,
        output
      };
    } catch (e: any) {
      return {
        toolCallId: toolCall.id,
        success: false,
        error: e.message || 'Tool execution failed'
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();
