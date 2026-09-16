import React, { useState, useEffect } from 'react';
import {
  ListOrdered,
  FileDiff,
  Files,
  Layers,
  Globe,
  Sparkles,
  Terminal,
  RotateCcw,
  Check,
  ExternalLink,
  Play,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChangesStore } from '../../stores/changesStore';
import { useQueueStore } from '../../stores/queueStore';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { SkillItem } from '../../../shared/types';

export const RightSidebar: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'queue' | 'changes' | 'files' | 'context' | 'preview' | 'skills'>('queue');
  const { changes, activeDiffFile, setActiveDiff, revertChange, clearChanges } = useChangesStore();
  const { items: queueItems, removeItem, runNext } = useQueueStore();
  const { startAgent, timeline } = useAgentStore();
  const { projectPath } = useProjectStore();

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:5173');

  useEffect(() => {
    if (window.electronAPI && projectPath) {
      window.electronAPI.listSkills(projectPath).then(setSkills).catch(console.error);
    }
  }, [projectPath]);

  // Collect files referenced in current session timeline
  const referencedFiles = Array.from(
    new Set(
      timeline
        .filter((item) => item.toolCall && (item.toolCall.args.path || item.toolCall.args.filePath))
        .map((item) => (item.toolCall?.args.path || item.toolCall?.args.filePath) as string)
    )
  );

  return (
    <div className="w-80 bg-d4-panel border-l border-d4-border flex flex-col h-full select-none text-xs">
      {/* Top Tab Switcher */}
      <div className="flex items-center border-b border-d4-border overflow-x-auto bg-d4-bg/60 p-1 space-x-1">
        {[
          { id: 'queue', label: t('rightSidebar.queue'), icon: ListOrdered },
          { id: 'changes', label: t('rightSidebar.changes'), icon: FileDiff, count: changes.length },
          { id: 'files', label: t('rightSidebar.files'), icon: Files },
          { id: 'context', label: t('rightSidebar.context'), icon: Layers },
          { id: 'preview', label: t('rightSidebar.preview'), icon: Globe },
          { id: 'skills', label: t('rightSidebar.skills'), icon: Sparkles }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-sm transition-colors whitespace-nowrap text-[11px] ${
                isActive
                  ? 'bg-d4-surface text-d4-text font-medium border border-d4-border'
                  : 'text-d4-muted hover:text-d4-text'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="w-4 h-4 rounded-full bg-d4-accent/20 text-d4-accent text-[9px] flex items-center justify-center font-bold">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* --- QUEUE TAB --- */}
        {activeTab === 'queue' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
              <span>{t('rightSidebar.queue')} ({queueItems.length})</span>
              {queueItems.length > 0 && (
                <button
                  onClick={runNext}
                  className="flex items-center space-x-1 text-d4-accent hover:underline lowercase"
                >
                  <Play className="w-3 h-3" />
                  <span>Run next</span>
                </button>
              )}
            </div>

            {queueItems.length === 0 ? (
              <div className="text-center py-10 text-d4-dimmed text-xs">
                {t('rightSidebar.emptyQueue')}
              </div>
            ) : (
              <div className="space-y-2">
                {queueItems.map((item, idx) => (
                  <div key={item.id} className="bg-d4-surface border border-d4-border rounded p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-d4-dimmed">#{idx + 1}</span>
                      <div className="flex items-center space-x-1">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-d4-panel border border-d4-border uppercase text-d4-accent font-medium">
                          {item.mode}
                        </span>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-d4-dimmed hover:text-red-400 p-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p className="text-d4-text text-xs leading-snug line-clamp-2">{item.prompt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- CHANGES TAB --- */}
        {activeTab === 'changes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-d4-dimmed text-[11px] uppercase font-semibold">
              <span>{changes.length} {t('rightSidebar.changes')}</span>
              {changes.length > 0 && (
                <button
                  onClick={clearChanges}
                  className="text-d4-dimmed hover:text-d4-text text-[10px]"
                >
                  {t('rightSidebar.revertAll')}
                </button>
              )}
            </div>

            {changes.length === 0 ? (
              <div className="text-center py-10 text-d4-dimmed text-xs">
                {t('rightSidebar.emptyChanges')}
              </div>
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
                      <span className="text-[10px] font-mono text-emerald-400">
                        +{change.additions} -{change.deletions}
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

        {/* --- FILES TAB --- */}
        {activeTab === 'files' && (
          <div className="space-y-3">
            <div className="text-d4-dimmed text-[11px] uppercase font-semibold">
              {t('rightSidebar.files')} ({referencedFiles.length})
            </div>
            {referencedFiles.length === 0 ? (
              <div className="text-center py-10 text-d4-dimmed text-xs">No files accessed in this task</div>
            ) : (
              <div className="space-y-1">
                {referencedFiles.map((file) => (
                  <div key={file} className="p-2 bg-d4-surface border border-d4-border rounded font-mono text-xs text-d4-text truncate">
                    {file}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- CONTEXT TAB --- */}
        {activeTab === 'context' && (
          <div className="space-y-3">
            <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('rightSidebar.context')}</div>
            <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-d4-muted">Estimated Context</span>
                <span className="text-d4-accent font-mono font-medium">~12.4K / 128K tokens</span>
              </div>
              <div className="w-full bg-d4-subtle h-1.5 rounded-full overflow-hidden">
                <div className="bg-d4-accent h-full w-[10%]" />
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-d4-muted">
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>System & Rules</span>
                <span className="font-mono text-d4-dimmed">~2.1K</span>
              </div>
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>Referenced Files</span>
                <span className="font-mono text-d4-dimmed">~4.5K</span>
              </div>
              <div className="flex justify-between py-1 border-b border-d4-border/40">
                <span>Session Conversation</span>
                <span className="font-mono text-d4-dimmed">~5.8K</span>
              </div>
            </div>
          </div>
        )}

        {/* --- PREVIEW TAB --- */}
        {activeTab === 'preview' && (
          <div className="flex flex-col h-full space-y-2">
            <div className="flex items-center space-x-1.5 bg-d4-surface border border-d4-border rounded p-1">
              <input
                type="text"
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                className="flex-1 bg-transparent px-2 py-0.5 text-xs text-d4-text outline-none font-mono"
              />
              <button
                onClick={() => window.open(previewUrl, '_blank')}
                className="p-1 hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded"
                title="Open in external browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 bg-white rounded border border-d4-border overflow-hidden min-h-[300px]">
              <iframe
                src={previewUrl}
                title="D4IDE Web Preview"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}

        {/* --- SKILLS TAB --- */}
        {activeTab === 'skills' && (
          <div className="space-y-3">
            <div className="text-d4-dimmed text-[11px] uppercase font-semibold">Available Skills</div>
            <div className="space-y-2">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => startAgent(`Execute skill: ${skill.name}\n${skill.content}`)}
                  className="bg-d4-surface hover:bg-d4-subtle/50 border border-d4-border rounded p-2.5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-d4-accent text-xs">/{skill.name}</span>
                    <span className="text-[10px] text-d4-dimmed">{skill.isGlobal ? 'Global' : 'Project'}</span>
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
