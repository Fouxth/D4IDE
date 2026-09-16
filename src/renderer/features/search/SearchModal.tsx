import React, { useState, useEffect } from 'react';
import { Search, FileCode, X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import path from 'path';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ file: string; line?: number; text?: string }[]>([]);
  const [searchMode, setSearchMode] = useState<'filename' | 'content'>('filename');
  const { projectPath, openFile } = useProjectStore();

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      return;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim() || !projectPath || !window.electronAPI) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        if (searchMode === 'filename') {
          const files = await window.electronAPI.searchFiles(projectPath, query);
          setResults(files.map((f: string) => ({ file: f })));
        } else {
          const grepResults = await window.electronAPI.grep(projectPath, query);
          setResults(grepResults);
        }
      } catch (e) {
        console.error('Search failed:', e);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, searchMode, projectPath]);

  if (!isOpen) return null;

  const handleSelect = (relPath: string) => {
    if (!projectPath) return;
    const fullPath = relPath.includes(':') || relPath.startsWith('/') ? relPath : `${projectPath}/${relPath}`;
    openFile(fullPath);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 select-none text-xs">
      <div className="w-[600px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[480px]">
        {/* Search header input */}
        <div className="flex items-center px-3 py-2.5 border-b border-d4-border bg-d4-surface space-x-2">
          <Search className="w-4 h-4 text-d4-dimmed" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchMode === 'filename' ? 'Search files by name...' : 'Search text across project...'}
            className="flex-1 bg-transparent text-sm text-d4-text outline-none"
          />
          <div className="flex items-center bg-d4-panel border border-d4-border rounded p-0.5 text-[10px]">
            <button
              onClick={() => setSearchMode('filename')}
              className={`px-2 py-0.5 rounded ${searchMode === 'filename' ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-dimmed'}`}
            >
              Files
            </button>
            <button
              onClick={() => setSearchMode('content')}
              className={`px-2 py-0.5 rounded ${searchMode === 'content' ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-dimmed'}`}
            >
              Grep
            </button>
          </div>
          <button onClick={onClose} className="p-1 text-d4-dimmed hover:text-d4-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {results.length === 0 ? (
            <div className="p-8 text-center text-d4-dimmed text-xs">
              {query ? 'No matching results' : 'Type to search...'}
            </div>
          ) : (
            results.map((res, i) => (
              <div
                key={i}
                onClick={() => handleSelect(res.file)}
                className="flex items-center justify-between p-2 rounded hover:bg-d4-surface cursor-pointer text-xs group"
              >
                <div className="flex items-center space-x-2 truncate">
                  <FileCode className="w-3.5 h-3.5 text-d4-dimmed group-hover:text-d4-accent" />
                  <span className="font-mono text-d4-text">{res.file}</span>
                  {res.line && <span className="text-d4-dimmed font-mono">:{res.line}</span>}
                </div>
                {res.text && <span className="text-[11px] text-d4-dimmed font-mono truncate max-w-[200px]">{res.text}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
