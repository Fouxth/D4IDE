import React, { useEffect, useState } from 'react';
import { ShieldAlert, Check, CheckCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApprovalRequest } from '../../../shared/types';

interface ApprovalDialogProps {
  request: ApprovalRequest | null;
  onResolve: (id: string, decision: 'approved' | 'approved_for_session' | 'rejected', toolName?: string) => void;
}

const TOOL_LABELS: Record<string, { th: string; en: string }> = {
  write_file: { th: 'เขียนทับไฟล์', en: 'Overwrite a file' },
  edit_file: { th: 'แก้ไขไฟล์', en: 'Edit a file' },
  create_file: { th: 'สร้างไฟล์ใหม่', en: 'Create a file' },
  delete_file: { th: 'ลบไฟล์', en: 'Delete a file' },
  move_file: { th: 'ย้าย/เปลี่ยนชื่อไฟล์', en: 'Move or rename a file' },
  run_terminal: { th: 'รันคำสั่งใน terminal', en: 'Run a terminal command' },
  run_tests: { th: 'รันการทดสอบ', en: 'Run the test suite' },
  run_build: { th: 'รัน build', en: 'Run the build' },
  git_commit: { th: 'commit โค้ด', en: 'Commit changes' },
  mcp_call: { th: 'เรียกใช้เครื่องมือ MCP', en: 'Call an MCP tool' },
  browser_action: { th: 'ควบคุมเบราว์เซอร์', en: 'Control the browser' }
};

export const ApprovalDialog: React.FC<ApprovalDialogProps> = ({ request, onResolve }) => {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
  }, [request?.id]);

  if (!request) return null;

  const language = (i18n.language as 'th' | 'en') === 'en' ? 'en' : 'th';
  const label = TOOL_LABELS[request.toolCall.name]?.[language] || request.toolCall.name;
  const argsPreview = JSON.stringify(request.toolCall.args, null, 2);

  const resolve = (decision: 'approved' | 'approved_for_session' | 'rejected') => {
    setPending(true);
    onResolve(request.id, decision, request.toolCall.name);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center select-none text-xs">
      <div className="w-[560px] bg-d4-panel border border-amber-500/40 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center space-x-2 px-4 py-3 border-b border-d4-border bg-amber-500/10">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-amber-300 text-sm">{t('approval.title')}</span>
          <span className="ml-auto text-[10px] text-d4-dimmed uppercase">{request.mode}</span>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-d4-text text-xs leading-relaxed">{t('approval.question', { action: label })}</p>
          {request.reason && <p className="text-[11px] text-d4-dimmed leading-relaxed">{request.reason}</p>}

          <div className="space-y-1">
            <div className="text-[10px] uppercase text-d4-dimmed font-mono">{request.toolCall.name}</div>
            <pre className="bg-d4-bg border border-d4-border rounded p-2.5 text-[11px] font-mono text-d4-muted whitespace-pre-wrap max-h-56 overflow-y-auto select-text">
              {argsPreview.length > 4000 ? `${argsPreview.slice(0, 4000)}\n…` : argsPreview}
            </pre>
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={() => resolve('approved')}
              disabled={pending}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-black font-semibold rounded-sm"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('approval.allowOnce')}</span>
            </button>
            <button
              onClick={() => resolve('approved_for_session')}
              disabled={pending}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-d4-surface hover:bg-d4-subtle border border-d4-border disabled:opacity-50 text-d4-text rounded-sm"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>{t('approval.allowSession')}</span>
            </button>
            <button
              onClick={() => resolve('rejected')}
              disabled={pending}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 disabled:opacity-50 text-red-400 rounded-sm ml-auto"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('approval.reject')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
