import React, { useState } from 'react';
import {
  Terminal,
  FileCode,
  FileEdit,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Play,
  RotateCcw,
  Check,
  AlertCircle
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { AgentTimelineItem, AgentTodo } from '../../../shared/types';

export const AgentTimeline: React.FC = () => {
  const { t } = useTranslation();
  const { timeline, todos, status, approvePlan, rejectPlan } = useAgentStore();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getToolIcon = (name: string) => {
    switch (name) {
      case 'read_file':
        return <FileCode className="w-3.5 h-3.5 text-blue-400" />;
      case 'edit_file':
      case 'write_file':
      case 'create_file':
        return <FileEdit className="w-3.5 h-3.5 text-amber-400" />;
      case 'run_terminal':
      case 'run_tests':
      case 'run_build':
        return <Terminal className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Sparkles className="w-3.5 h-3.5 text-d4-accent" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm select-text">
      {/* Todos Widget if present */}
      {todos.length > 0 && (
        <div className="bg-d4-panel border border-d4-border rounded-md p-3 select-none">
          <div className="text-xs font-semibold uppercase text-d4-dimmed mb-2 flex items-center justify-between">
            <span>{t('agent.todosTitle')}</span>
            <span className="text-d4-accent font-mono">
              {todos.filter((t) => t.status === 'completed').length} / {todos.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-center space-x-2 text-xs">
                {todo.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                {todo.status === 'in_progress' && <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />}
                {todo.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-d4-dimmed shrink-0" />}
                {todo.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                <span className={todo.status === 'completed' ? 'line-through text-d4-dimmed' : 'text-d4-text'}>
                  {todo.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {timeline.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-center py-20 text-d4-dimmed">
          <div className="w-12 h-12 rounded-full bg-d4-panel border border-d4-border flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6 text-d4-accent" />
          </div>
          <p className="max-w-sm text-xs leading-relaxed">{t('agent.noActivity')}</p>
        </div>
      )}

      {/* Timeline Items */}
      {timeline.map((item) => {
        const isExpanded = !!expandedItems[item.id];

        // --- PLAN CARD ---
        if (item.type === 'plan') {
          return (
            <div key={item.id} className="bg-amber-500/10 border border-amber-500/30 rounded-md p-4 shadow-sm">
              <div className="flex items-center space-x-2 text-amber-400 font-semibold mb-2">
                <Sparkles className="w-4 h-4" />
                <span>{item.title}</span>
              </div>
              <div className="text-xs text-d4-text whitespace-pre-wrap leading-relaxed font-mono bg-d4-bg/50 p-3 rounded border border-d4-border mb-3">
                {item.content}
              </div>

              {status === 'waiting_approval' && (
                <div className="flex items-center space-x-2 pt-2 border-t border-amber-500/20">
                  <button
                    onClick={approvePlan}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs rounded-sm transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('agent.approvePlan')}</span>
                  </button>
                  <button
                    onClick={rejectPlan}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs rounded-sm transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('agent.rejectPlan')}</span>
                  </button>
                </div>
              )}
            </div>
          );
        }

        // --- SUMMARY ITEM ---
        if (item.type === 'summary') {
          return (
            <div key={item.id} className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-4 shadow-sm">
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold mb-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>{item.title}</span>
              </div>
              <div className="text-xs text-d4-text whitespace-pre-wrap leading-relaxed">
                {item.content}
              </div>
            </div>
          );
        }

        // --- ERROR ITEM ---
        if (item.type === 'error') {
          return (
            <div key={item.id} className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-400">{item.title}</div>
                <div className="text-d4-muted mt-1 whitespace-pre-wrap">{item.content}</div>
              </div>
            </div>
          );
        }

        // --- TOOL CALL / TOOL RESULT ROW ---
        if (item.type === 'tool_call' || item.type === 'tool_result') {
          return (
            <div key={item.id} className="bg-d4-surface border border-d4-border rounded-sm overflow-hidden text-xs">
              <div
                onClick={() => toggleExpand(item.id)}
                className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-d4-subtle/50 transition-colors"
              >
                <div className="flex items-center space-x-2">
                  {getToolIcon(item.toolCall?.name || '')}
                  <span className="font-mono font-medium text-d4-text">{item.title}</span>
                  {item.status === 'running' && <span className="text-[10px] text-amber-400 animate-pulse">Running...</span>}
                  {item.status === 'success' && <span className="text-[10px] text-emerald-400">Success</span>}
                  {item.status === 'failed' && <span className="text-[10px] text-red-400">Failed</span>}
                </div>
                <div className="text-d4-dimmed">
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </div>
              </div>

              {isExpanded && item.content && (
                <div className="px-3 py-2 bg-d4-bg/80 border-t border-d4-border text-[11px] font-mono text-d4-muted whitespace-pre-wrap overflow-x-auto max-h-60">
                  {item.content}
                </div>
              )}
            </div>
          );
        }

        // --- MESSAGE ITEM (User or Assistant text) ---
        return (
          <div
            key={item.id}
            className={`p-3 rounded-md text-xs leading-relaxed ${
              item.title === 'User Prompt'
                ? 'bg-d4-panel border border-d4-border text-d4-text max-w-2xl ml-auto'
                : 'bg-transparent text-d4-text whitespace-pre-wrap'
            }`}
          >
            {item.title !== 'User Prompt' && (
              <div className="font-semibold text-d4-accent text-[11px] mb-1 flex items-center space-x-1.5">
                <Sparkles className="w-3 h-3" />
                <span>{item.title}</span>
              </div>
            )}
            <div className="whitespace-pre-wrap">{item.content}</div>
          </div>
        );
      })}
    </div>
  );
};
