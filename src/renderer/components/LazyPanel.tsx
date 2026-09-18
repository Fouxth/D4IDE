import React, { Suspense } from 'react';

/**
 * The boundary around a screen that is fetched on demand.
 *
 * A lazy screen has one visible consequence: the first time it is opened there
 * is a moment with nothing to show. Leaving that moment blank is what makes a
 * lazily loaded panel feel broken, so the placeholder states what is happening
 * in the same dimmed style the editor already uses while Monaco loads.
 *
 * The fallback claims the same space as its panel, so opening the terminal does
 * not make the whole layout jump — it appears where the terminal will be.
 */
export const LazyPanel: React.FC<{
  label: string;
  /** Fixed height for a docked panel; omit for one that fills flex space. */
  height?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, height, className, children }) => (
  <Suspense
    fallback={
      <div
        className={`${height ? 'shrink-0' : 'flex-1 min-h-0'} flex items-center justify-center text-xs text-d4-dimmed ${className ?? ''}`}
        style={height ? { height } : undefined}
      >
        {label}
      </div>
    }
  >
    {children}
  </Suspense>
);

/** For overlays: a dialog that has not arrived yet must not shift the layout. */
export const LazyOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={null}>{children}</Suspense>
);
