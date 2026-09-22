import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A right-click menu, positioned at the pointer.
 *
 * The app had no context menu at all, and a menu is the one interaction that
 * cannot be discovered by looking at the screen — so when one exists it has to
 * behave exactly like the platform's: it opens at the cursor, it never hangs off
 * an edge, Escape and a click anywhere else close it, and the arrow keys walk
 * the items. The panel is measured before it is shown (one layout pass, no
 * flicker) because the clamp depends on its real height.
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  /** Rendered in the error colour: closing or deleting lives here. */
  danger?: boolean;
}

export interface ContextMenuRequest {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Named for screen readers, e.g. "Space: my-project". */
  label?: string;
}

const PANEL_WIDTH = 224;
const EDGE = 6;

export const ContextMenu: React.FC<{ request: ContextMenuRequest | null; onClose: () => void }> = ({
  request,
  onClose
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: -9999, top: -9999, ready: false });

  // Measure, then place. Doing it in the same frame as the first paint avoids a
  // menu that appears in the corner and jumps to the cursor.
  useLayoutEffect(() => {
    if (!request) return;
    const height = panelRef.current?.offsetHeight ?? 0;
    const maxX = window.innerWidth - PANEL_WIDTH - EDGE;
    const maxY = window.innerHeight - height - EDGE;
    setPosition({
      left: Math.max(EDGE, Math.min(request.x, maxX)),
      top: Math.max(EDGE, Math.min(request.y, maxY)),
      ready: true
    });
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[(current + 1) % items.length].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        items[(current - 1 + items.length) % items.length].focus();
      }
    };
    const onScrollOrResize = () => onClose();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('wheel', onScrollOrResize, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('wheel', onScrollOrResize);
    };
  }, [request, onClose]);

  useEffect(() => {
    if (!request) return;
    // Focus the first real item so the keyboard works without a click.
    const first = panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    first?.focus();
  }, [request, position.ready]);

  if (!request) return null;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={request.label ?? t('common.menu')}
      className="fixed z-[70] py-1 bg-d4-panel border border-d4-border rounded-md shadow-2xl"
      style={{
        left: position.left,
        top: position.top,
        width: PANEL_WIDTH,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {request.items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors rounded-sm disabled:opacity-40 disabled:cursor-not-allowed ${
              item.danger
                ? 'text-red-400/90 hover:text-red-400 hover:bg-d4-surface'
                : 'text-d4-muted hover:text-d4-text hover:bg-d4-surface'
            }`}
          >
            {Icon ? <Icon className="w-3.5 h-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * The state every right-clickable surface needs.
 *
 * Opening from the `onContextMenu` event is the whole point: the browser has
 * already computed the pointer position, and `preventDefault` is what stops the
 * OS menu from covering ours.
 */
export function useContextMenu() {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null);

  const open = (event: React.MouseEvent, items: ContextMenuItem[], label?: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (items.length === 0) return;
    setRequest({ x: event.clientX, y: event.clientY, items, label });
  };

  const close = React.useCallback(() => setRequest(null), []);
  return { request, open, close };
}
