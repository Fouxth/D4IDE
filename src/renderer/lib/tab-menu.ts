import { ContextMenuItem } from '../components/ContextMenu';

/**
 * What a space's right-click menu offers, decided without touching a store.
 *
 * The same menu hangs off the tab strip and off the rail on the left, and the
 * two must not drift: a tab that cannot be renamed in one place must not be
 * renameable in the other. Keeping the entries here means the rules are stated
 * once and can be tested: a `__`-prefixed tab stands for the renderer-only
 * preview, which has no stored session behind it, so there is nothing to rename
 * or close — and "close the others" has nothing to do when it is alone.
 */
export type TabMenuAction = 'new-space' | 'rename' | 'close' | 'close-others';

export interface TabMenuEntry {
  id: TabMenuAction;
  /** i18n key — the label is resolved by the caller, which owns the language. */
  labelKey: string;
  disabled: boolean;
  /** Closing something is destructive-adjacent, so it is coloured apart. */
  danger: boolean;
}

export interface TabMenuFacts {
  /** The id of the tab or rail item that was right-clicked. */
  tabId: string;
  /** How many *other* real sessions are open right now. */
  otherOpenCount: number;
}

/** A `__`-prefixed tab (`__local__`, the renderer-only preview) has no stored session. */
export function isPlaceholderTab(tabId: string): boolean {
  return tabId.startsWith('__');
}

export function tabMenuEntries({ tabId, otherOpenCount }: TabMenuFacts): TabMenuEntry[] {
  const placeholder = isPlaceholderTab(tabId);
  return [
    { id: 'new-space', labelKey: 'nav.spaceNewFolder', disabled: false, danger: false },
    { id: 'rename', labelKey: 'nav.spaceRename', disabled: placeholder, danger: false },
    { id: 'close', labelKey: 'nav.spaceClose', disabled: placeholder, danger: true },
    {
      id: 'close-others',
      labelKey: 'nav.spaceCloseOthers',
      // Nothing to close, so the entry is honest rather than a no-op.
      disabled: otherOpenCount === 0,
      danger: true
    }
  ];
}

/** Counts the real sessions a menu should consider "the others". */
export function otherOpenCount(tabIds: string[], exceptId: string): number {
  return tabIds.filter((id) => id !== exceptId && !isPlaceholderTab(id)).length;
}

/**
 * Turns entries into the items a `ContextMenu` renders, binding each action to
 * the handler the surface owns. Kept separate from the rules above so the
 * component stays a list of buttons.
 */
export function bindTabMenu(
  entries: TabMenuEntry[],
  handlers: Record<TabMenuAction, () => void>,
  translate: (key: string) => string,
  icons: Partial<Record<TabMenuAction, ContextMenuItem['icon']>>
): ContextMenuItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    label: translate(entry.labelKey),
    icon: icons[entry.id],
    disabled: entry.disabled,
    danger: entry.danger,
    onSelect: handlers[entry.id]
  }));
}
