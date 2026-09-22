import path from 'path';

/**
 * The two strongest laws, as code: where a tool call is allowed to point, and
 * what it is allowed to destroy.
 *
 * A prompt can ask a model to behave; it cannot stop one that does not. These
 * checks run on the tool call itself, before anything is executed, on every
 * provider and in every permission mode — including Full Access, where no dialog
 * can appear to catch a mistake. They are pure (string in, verdict out) so every
 * rule here is testable without a provider or a real file tree.
 */
const WINDOWS = process.platform === 'win32';
const SEPARATORS = /[/\\]+/;

export interface ProjectScope {
  /** The path as resolved against the project, with `..` already applied. */
  resolved: string;
  /** False when the target is outside the project root. */
  inside: boolean;
  /** True when the target contains the project root (a drive, `C:\Users`, …). */
  isRootOrAbove: boolean;
}

/**
 * Where a target path actually lands, once `..` and separators are resolved.
 *
 * This is the check that makes "stay in the project" real: without it a model
 * can be handed `F:\HuayD` and write to `C:\Windows` or a second project, and
 * nothing in the engine notices. A missing project path is the one case treated
 * as "cannot judge" — a run always has one, because the app asks for a folder
 * before the first prompt.
 */
export function checkProjectScope(projectPath: string | null | undefined, target: string): ProjectScope {
  const root = (projectPath ?? '').trim();
  const raw = (target ?? '').toString().trim();
  if (!root || !raw) return { resolved: raw, inside: true, isRootOrAbove: false };

  const rootResolved = path.resolve(root);
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootResolved, raw);

  const compare = (value: string) => (WINDOWS ? value.toLowerCase() : value);
  const target_ = compare(resolved);
  const base = compare(rootResolved);
  const within = (child: string, parent: string) =>
    child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

  return {
    resolved,
    inside: within(target_, base),
    isRootOrAbove: !within(target_, base) && within(base, target_)
  };
}

/** Terminal verbs that change the file system, wherever they point. */
const MUTATING_COMMAND =
  /(^|[\s;&|(])(rm|rmdir|rd|del|erase|unlink|move|mv|copy|cp|robocopy|xcopy|mkdir|md|new-item|set-content|add-content|out-file|clear-content|remove-item|touch|truncate|chmod|chown|takeown|icacls|attrib|rimraf)\b/i;

/** Delete verbs that can take a directory, in either shell. */
const DIRECTORY_DELETE = /\b(rm|rmdir|rd|del|remove-item|rimraf)\b/i;

/**
 * A recursive delete, in either shell.
 *
 * `rm -rf dir`, `rd /s /q dir` and `Remove-Item -Recurse dir` are the three ways
 * a project loses a directory in one call, and all three are what the law
 * "recursive deletes need confirmation" is about.
 */
export function isRecursiveDelete(command: string): boolean {
  const body = command ?? '';
  return (
    /\brm\s+(-[a-z-]*\s+)*-[a-z-]*r[a-z-]*f?/i.test(body) ||
    /\brm\s+(-[a-z-]*\s+)*-[a-z-]*f[a-z-]*r[a-z-]*/i.test(body) ||
    /\b(rmdir|rd)\s+[^|;&]*\/s\b/i.test(body) ||
    /\bdel\s+[^|;&]*\/s\b/i.test(body) ||
    /\bremove-item\b[^|;&]*-recurse\b/i.test(body) ||
    /\bgit\s+clean\s+-[a-z]*[fd][a-z]*\b/i.test(body) ||
    /\brimraf\b/i.test(body)
  );
}

/**
 * Splits a command into the tokens that could be a path.
 *
 * Only shell punctuation is stripped from the edges — never `*` or `.`, which is
 * exactly what `rm -rf *` is made of. An earlier version stripped every leading
 * non-word character, which quietly turned the wildcard into an empty token and
 * let "delete everything in this folder" through the guard.
 */
function pathTokens(command: string): string[] {
  return (command ?? '')
    .split(/[\s"'`]+/)
    .map((token) => token.replace(/^[(&|;]+|[;,)]+$/g, ''))
    .filter(Boolean);
}

/** Everything under the working directory, however it is spelled. */
const EVERYTHING_HERE = /^(\.|\*|\.\/|\.\\|\*\.\*|\.\*|\/$|\\$|\*\/\*|\.\/\*)$/;

/**
 * Does this command delete the project root, a folder above it, or everything
 * inside it?
 *
 * This is the law the user asked for in plain words — "ห้ามลบโปรเจกต์ทั้งหมด
 * ถ้าไม่ได้สั่ง" — and the previous guard did not cover it: it blocked `rm -rf /`
 * and `rm -rf C:\` but let `rm -rf .`, `rm -rf *` and `git clean -xfd` through,
 * which is how a project actually disappears in one call.
 */
export function deletesProjectRoot(command: string, projectPath: string | null | undefined): boolean {
  const body = (command ?? '').trim();
  if (!body) return false;

  // At the project root this removes every untracked file and folder at once.
  if (/\bgit\s+clean\s+-[a-z]*[fd][a-z]*\b/i.test(body)) return true;

  if (!DIRECTORY_DELETE.test(body)) return false;

  const root = (projectPath ?? '').trim();
  const rootResolved = root ? path.resolve(root) : '';
  const rootName = rootResolved ? rootResolved.split(SEPARATORS).filter(Boolean).pop() || '' : '';

  for (const rawToken of pathTokens(body)) {
    const token = rawToken.replace(/^-+/, '');
    if (!token) continue;
    if (EVERYTHING_HERE.test(token)) return true;
    // Deleting the folder that holds the project deletes the project with it.
    if (token === '..' || /^\.\.[/\\]/.test(token)) return true;
    if (!rootResolved) continue;
    const scope = checkProjectScope(rootResolved, token);
    if (scope.inside && scope.resolved === rootResolved) return true;
    if (scope.isRootOrAbove) return true;
    // `rm -rf HuayD` typed from the project's parent folder.
    if (rootName && token.replace(/[/\\]+$/, '').toLowerCase() === rootName.toLowerCase()) return true;
  }
  return false;
}

/**
 * The first absolute path in a command that points outside the project, when the
 * command changes the file system.
 *
 * Reads are left alone on purpose: a project may legitimately read a global
 * config or a toolchain file, and refusing that would be a rule the user never
 * asked for. What is refused is a *write* aimed outside the folder the app was
 * given.
 */
export function writesOutsideProject(command: string, projectPath: string | null | undefined): string | null {
  const body = (command ?? '').trim();
  const root = (projectPath ?? '').trim();
  if (!body || !root) return null;

  const writes = MUTATING_COMMAND.test(body) || />>?(?!&)/.test(body);
  if (!writes) return null;

  // A redirect target is the clearest write there is; check those first.
  const redirects = [...body.matchAll(/>>?\s*([^\s"'|;&]+)/g)].map((match) => match[1]);
  for (const candidate of [...redirects, ...pathTokens(body)]) {
    const looksLikePath = path.isAbsolute(candidate) || /^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith('~');
    if (!looksLikePath || candidate.includes('://')) continue;
    const scope = checkProjectScope(root, candidate);
    if (!scope.inside) return candidate;
  }
  return null;
}
