import React from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToastStore, ToastKind } from '../stores/toastStore';

const ICONS: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle
};

const STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-500/40 bg-red-500/10 text-red-300',
  info: 'border-d4-border bg-d4-surface text-d4-text',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300'
};

export const ToastHost: React.FC = () => {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-[60] flex flex-col space-y-2 w-80 pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto border rounded-md px-3 py-2 shadow-xl flex items-start space-x-2 text-xs animate-in fade-in slide-in-from-bottom-2 ${STYLES[t.kind]}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium break-words">{t.message}</div>
              {t.detail && <div className="text-[11px] opacity-80 mt-0.5 break-words">{t.detail}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
