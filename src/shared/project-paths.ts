/**
 * Does this folder belong to that project?
 *
 * The question is asked in two processes — the main process, to decide whose dev
 * server printed an address, and the renderer, to decide whether an address
 * belongs in the panel that is open — so the answer lives in one place.
 *
 * Both directions count, because a server is often started from a workspace
 * inside the open folder (`apps/web`) and just as often from a folder that
 * contains it. Comparison is case-insensitive and separated on both slash
 * styles: the same path arrives as `F:\app` from the OS and as `f:/app` from a
 * lockfile or a command line.
 */
export function insideFolder(
  folder: string | null | undefined,
  projectPath: string | null | undefined
): boolean {
  if (!folder || !projectPath) return false;
  const clean = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = clean(folder);
  const b = clean(projectPath);
  if (!a || !b) return false;
  if (a === b) return true;
  // A path segment boundary, not a prefix: `F:/app-old` is not inside `F:/app`.
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
