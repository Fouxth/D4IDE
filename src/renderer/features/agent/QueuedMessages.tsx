import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, GripVertical, Pause, Pencil, Play, Send, Trash2, X } from 'lucide-react';
import { useQueueStore } from '../../stores/queueStore';
import { reorderTargets } from '../../lib/queue-reorder';
import { TaskQueueItem } from '../../../shared/types';

/**
 * Queued messages, one row above the field they were typed in.
 *
 * While a run is in flight the composer accepts text but cannot send it, so the
 * message is parked. Parking without showing it is the failure mode this exists
 * to prevent: the user has typed a sentence, the box is empty again, and nothing
 * on screen says where the sentence went. Each waiting message therefore sits in
 * its own row — the text itself, its attachments, and the three things anyone
 * wants to do with a message that has not gone out yet: send it now, fix a word,
 * or drop it.
 *
 * Rows start collapsed to one line. Opening one is a reading act, not a mode.
 *
 * Order is the user's: the grip drags a message to another position, and the
 * arrow keys do the same from the keyboard. That order is what runs next, so it
 * has to be editable before the queue starts — otherwise the only way to change
 * your mind is to delete a message and type it again.
 */
export const QueuedMessages: React.FC = () => {
  const { t } = useTranslation();
  const items = useQueueStore((state) => state.items);
  const removeItem = useQueueStore((state) => state.removeItem);
  const updateItem = useQueueStore((state) => state.updateItem);
  const runItem = useQueueStore((state) => state.runItem);
  const reorderItems = useQueueStore((state) => state.reorderItems);
  const moveItem = useQueueStore((state) => state.moveItem);
  // Queue-wide controls. They used to live in the sidebar's queue tab; the tab
  // is gone, and these are the only bits of it nothing else could do.
  const autoRun = useQueueStore((state) => state.autoRun);
  const pauseAll = useQueueStore((state) => state.pauseAll);
  const resumeAll = useQueueStore((state) => state.resumeAll);

  /** Ids of the rows showing their full text. */
  const [open, setOpen] = useState<string[]>([]);
  /** The row being edited, and the draft that edit holds. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** The row under the cursor while a drag is in flight. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /**
   * The dragged id, held in a ref as well as in state.
   *
   * State drives the highlight, and it lands a frame late: a drag that starts and
   * drops inside one frame would be read as "nothing is being dragged" and the
   * drop would be lost. The ref is written synchronously, so the drop always
   * knows what it is moving; the transfer payload is set too, because that is
   * what makes a drag legal on every platform.
   */
  const dragRef = useRef<string | null>(null);

  // Only what has not started yet: a running or finished task is the timeline's
  // business, and 'paused' belongs here because it is still waiting to go out.
  const waiting = items.filter((item) => item.status === 'queued' || item.status === 'paused');
  if (waiting.length === 0) return null;

  const toggleRow = (id: string) =>
    setOpen((list) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]));

  const startEdit = (item: TaskQueueItem) => {
    setEditing(item.id);
    setDraft(item.prompt);
    setOpen((list) => (list.includes(item.id) ? list : [...list, item.id]));
  };

  const saveEdit = (id: string) => {
    const prompt = draft.trim();
    // An empty message is not a message: saving one would leave a row that
    // cannot be sent and cannot be read.
    if (!prompt) return;
    updateItem(id, { prompt });
    setEditing(null);
  };

  const removeImage = (item: TaskQueueItem, imageId: string) => {
    const images = (item.images ?? []).filter((image) => image.id !== imageId);
    updateItem(item.id, { images: images.length > 0 ? images : undefined });
  };

  const commitDrop = (draggedId: string | null, overId: string) => {
    const target = draggedId ? reorderTargets(items.map((entry) => entry.id), draggedId, overId) : null;
    if (target) reorderItems(target.from, target.to);
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  const iconButton = 'd4-icon-button w-6 h-6';

  /**
   * The grip: drag with the mouse, or move one row with the arrow keys. A drag
   * handle is also a control, and a queue only reachable by mouse is a queue a
   * keyboard user cannot reorder at all.
   */
  const grip = (item: TaskQueueItem, index: number) => (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        dragRef.current = item.id;
        setDragId(item.id);
        // Some platforms cancel a drag that carries no payload.
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        dragRef.current = null;
        setDragId(null);
        setOverId(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        if (index + direction < 0 || index + direction >= waiting.length) return;
        moveItem(item.id, direction);
      }}
      title={t('agent.queueDrag')}
      aria-label={t('agent.queueDrag')}
      className={`mt-[1px] shrink-0 cursor-grab active:cursor-grabbing transition-colors ${
        dragId === item.id ? 'text-d4-accent' : 'text-d4-dimmed hover:text-d4-text'
      }`}
    >
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="mb-1.5 space-y-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] text-d4-dimmed">
        <span className="uppercase tracking-wide font-semibold">
          {t('agent.queueTitle', { count: waiting.length })}
        </span>
        <span className="flex-1 h-px bg-d4-border-subtle" />
        {/*
         * Pause/resume and clear, carried over from the queue tab this strip
         * replaces. A paused queue must stay visible somewhere, and the row
         * header is where the queue itself already lives.
         */}
        <button
          type="button"
          onClick={() => (autoRun ? pauseAll() : resumeAll())}
          title={autoRun ? t('rightSidebar.pauseQueue') : t('rightSidebar.resumeQueue')}
          className={`p-0.5 rounded-sm transition-colors ${
            autoRun ? 'text-d4-dimmed hover:text-d4-text' : 'text-d4-warning'
          }`}
        >
          {autoRun ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={() => useQueueStore.getState().clearFinished()}
          title={t('rightSidebar.clearFinished')}
          className="p-0.5 rounded-sm text-d4-dimmed hover:text-d4-text transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {waiting.map((item, index) => {
        const isOpen = open.includes(item.id);
        const isEditing = editing === item.id;
        const images = item.images ?? [];
        const isTarget = !!dragId && overId === item.id && dragId !== item.id;
        return (
          <div
            key={item.id}
            onDragOver={(event) => {
              // Only a row drag is accepted: files dropped over the queue are the
              // composer's business, and swallowing them here would lose them.
              if (!dragRef.current) return;
              event.preventDefault();
              setOverId(item.id);
            }}
            onDrop={(event) => {
              const dragged = dragRef.current || event.dataTransfer.getData('text/plain');
              if (!dragged) return;
              event.preventDefault();
              commitDrop(dragged, item.id);
            }}
            className={`rounded-lg border bg-d4-panel/80 px-2 py-1.5 transition-colors ${
              isTarget ? 'border-d4-accent' : 'border-d4-border'
            } ${dragId === item.id ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start gap-1.5">
              {grip(item, index)}

              <button
                type="button"
                onClick={() => toggleRow(item.id)}
                aria-expanded={isOpen}
                title={t(isOpen ? 'agent.queueCollapse' : 'agent.queueExpand')}
                className="mt-[1px] shrink-0 text-d4-dimmed hover:text-d4-text transition-colors"
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {/* The message itself: one line while collapsed, whole while open. */}
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="space-y-1.5">
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setEditing(null);
                        // Enter saves, Shift+Enter keeps a line — the same
                        // agreement the composer itself uses.
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          saveEdit(item.id);
                        }
                      }}
                      rows={3}
                      className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1.5 text-[12px] leading-relaxed text-d4-text focus:outline-none focus:border-d4-accent resize-none"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEdit(item.id)}
                        disabled={!draft.trim()}
                        className="flex items-center gap-1 px-2 py-1 rounded border border-d4-accent/50 text-d4-accent text-[10px] font-semibold hover:bg-d4-accent/10 disabled:opacity-40"
                      >
                        <Check className="w-3 h-3" />
                        {t('common.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="px-2 py-1 rounded text-[10px] text-d4-dimmed hover:text-d4-text"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleRow(item.id)}
                    className={`block w-full text-left text-[12px] leading-relaxed ${
                      isOpen ? 'text-d4-text whitespace-pre-wrap break-words' : 'text-d4-muted truncate'
                    }`}
                  >
                    {item.prompt}
                  </button>
                )}

                {isOpen && !isEditing && images.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {images.map((image) => (
                      <div key={image.id} className="relative group">
                        <img
                          src={`data:${image.mimeType};base64,${image.data}`}
                          alt={image.name}
                          className="h-12 w-12 object-cover rounded border border-d4-border"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(item, image.id)}
                          title={t('common.remove')}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-d4-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isOpen && !isEditing && (
                  <div className="mt-1 text-[10px] text-d4-dimmed">
                    {t(item.mode === 'plan' ? 'agent.queueWillPlan' : 'agent.queueWillBuild')}
                  </div>
                )}
              </div>

              {!isEditing && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => runItem(item.id)}
                    title={t('agent.queueRunNow')}
                    className={iconButton}
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    title={t('agent.queueEdit')}
                    className={iconButton}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    title={t('agent.queueRemove')}
                    className={`${iconButton} hover:text-d4-error`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
