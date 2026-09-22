/**
 * Which local port a dev server is allowed to use.
 *
 * Letting every project pick its own default is how two projects end up on the
 * same number, or a preview panel ends up looking at another project's app:
 * Vite wants 5173, Next wants 3000, and the second server that starts either
 * collides or silently slides to the next number — so the address a project
 * prints stops being the address anyone can predict.
 *
 * The rule here is the user's: a frontend serves from 1000 upward, a backend
 * from 3000 upward, and a port this app has already handed out is never handed
 * out twice. A project therefore keeps its own number for as long as the app
 * runs, and two projects can never fight over one.
 *
 * Everything in this file is pure and therefore testable: the classification is
 * a guess read off a command line, and a guess is worth pinning down without
 * spawning anything.
 */

export type DevServerKind = 'client' | 'server';

/** Where each kind of server starts looking for a port, and where it stops. */
export const DEV_PORT_RANGES: Record<DevServerKind, { first: number; last: number }> = {
  client: { first: 1000, last: 2999 },
  server: { first: 3000, last: 5999 }
};

/** True when the port belongs to the range reserved for this kind of server. */
export function portInRange(kind: DevServerKind, port: number): boolean {
  const { first, last } = DEV_PORT_RANGES[kind];
  return Number.isInteger(port) && port >= first && port <= last;
}

/**
 * The first port in the range that nothing is holding.
 *
 * `busy` is everything already spoken for: ports a development process is
 * listening on right now, plus the ports this app has handed to other projects.
 * Exhausting a 2000-port range takes more dev servers than a machine can hold,
 * so the fallback (the first of the range) is a formality rather than a policy.
 */
export function firstFreePort(kind: DevServerKind, busy: Iterable<number>): number {
  const taken = new Set(busy);
  const { first, last } = DEV_PORT_RANGES[kind];
  for (let port = first; port <= last; port += 1) {
    if (!taken.has(port)) return port;
  }
  return first;
}

/** A script named for the backend rather than for the browser app. */
const SERVER_SCRIPT_NAME = /(?:^|[\s:_-])(server|backend|back|api|worker|service|db)(?:$|[\s:_-])/i;

/** A script named for the frontend, even when its body is unreadable. */
const CLIENT_SCRIPT_NAME = /(?:^|[\s:_-])(client|front|frontend|web|ui|app|site|spa)(?:$|[\s:_-])/i;

/**
 * Runtimes and CLIs that serve a *browser* app while developing.
 *
 * Checked before the backend patterns, because a project that serves a frontend
 * and an API from one script is previewed through the frontend: that is the part
 * a browser window can show.
 */
const CLIENT_TOOL =
  /(\bvite\b|react-scripts|create-react-app|\bnext\b|\bnuxt\b|\bastro\b|svelte-kit|\bsvelte\b|vue-cli-service|\bng\s+serve\b|angular|\bwebpack\b|\bparcel\b|\bremix\b|solid-start|\bpreact\b|\bexpo\b|storybook|\beleventy\b|http-server|live-server|browser-sync|\bserve\b|vite-node)/i;

/**
 * Stacks that serve an API, a worker or a database-backed service.
 *
 * A bare `node file.js` is in here on purpose: a plain node process is something
 * that talks to a frontend, not something that renders one.
 */
const SERVER_TOOL =
  /(express|\bfastify\b|\bnest\b|\bkoa\b|\bhapi\b|uvicorn|gunicorn|hypercorn|\bflask\b|django|runserver|\brails\b|dotnet\s+run|\bspring\b|quarkus|\bgo\s+run\b|artisan\s+serve|php\s+-S|celery|\bnodemon\b|\bts-node\b|\btsx\b|\bnode\b|\bdeno\s+run\b|\bserver\b|\bbackend\b|\bapi\b|\bworker\b)/i;

/**
 * Which range this dev server belongs in.
 *
 * The script name is asked first — a project that names a script `dev:server`
 * has already answered the question — then the command that runs, then the
 * script body. A frontend is the default, because a preview panel is about what
 * a browser window can show.
 */
export function classifyDevServer(input: {
  script?: string;
  body?: string;
  command?: string;
}): DevServerKind {
  const script = input.script ?? '';
  if (SERVER_SCRIPT_NAME.test(script)) return 'server';
  if (CLIENT_SCRIPT_NAME.test(script)) return 'client';

  // The command carries the package manager; the body carries the tool. Both are
  // read, because either one may be all that is available.
  const text = `${input.body ?? ''} ${input.command ?? ''}`.trim();
  if (!text) return 'client';
  if (CLIENT_TOOL.test(text)) return 'client';
  if (SERVER_TOOL.test(text)) return 'server';
  return 'client';
}

/** Script names that mean "serve this project", however they are run. */
const DEV_SCRIPT_RUN = /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(dev|start|serve|develop|preview|watch)\b/i;

/** Backends whose whole job is to listen on a port. */
const SERVER_HINT =
  /(express|fastify|nest|koa|hapi|uvicorn|gunicorn|hypercorn|flask|django|runserver|rails|dotnet\s+run|spring|quarkus|go\s+run|artisan\s+serve|php\s+-S|celery)/i;

/** A bare node process is only a server when the file it runs looks like one. */
const NODE_SERVER_FILE = /\bnode\s+\S*(server|api|app|index|main|http|listen)/i;

/**
 * Does this command start something a browser could look at?
 *
 * The question matters because a port is only worth reserving, exporting and
 * remembering for a process that will actually listen on it: a `node
 * scripts/seed.js` that runs once and exits must not leave a preview address
 * behind that answers nothing.
 */
export function looksLikeDevServer(text: string | undefined): boolean {
  const line = (text ?? '').trim();
  if (!line) return false;
  if (DEV_SCRIPT_RUN.test(line)) return true;
  return CLIENT_TOOL.test(line) || SERVER_HINT.test(line) || NODE_SERVER_FILE.test(line);
}

/** A command line that already says where to listen must not be corrected twice. */
const NAMES_A_PORT = /(?:--port|--listen|--host|-p|-l|-H)\s*=?\s*\d{2,5}\b/i;

/**
 * The CLIs that take their port on the command line, and the spelling each one
 * uses. `serve` wants `-l`, `next` wants `-p`, everything bundler-shaped in
 * between wants `--port`.
 */
const PORT_FLAG_TOOLS: { pattern: RegExp; flag: (port: number) => string }[] = [
  { pattern: /\bhttp-server\b/i, flag: (port) => `-p ${port}` },
  { pattern: /\blive-server\b/i, flag: (port) => `--port=${port}` },
  { pattern: /\bnext\b/i, flag: (port) => `-p ${port}` },
  { pattern: /(?:^|[\s"'(])serve(?:\s|$)/i, flag: (port) => `-l ${port}` },
  { pattern: /python\s+-m\s+http\.server/i, flag: (port) => String(port) },
  {
    pattern: /\b(vite|vite-node|nuxt|astro|ng|react-scripts|webpack|parcel|remix|eleventy|expo|storybook|vue-cli-service|svelte-kit)\b/i,
    flag: (port) => `--port ${port}`
  }
];

/**
 * The argument that moves this command to `port`, or null when it cannot be
 * moved from its command line at all.
 *
 * A null is not a failure: a plain `node server.js` reads `PORT` from the
 * environment instead, which is why the caller always exports it too.
 */
export function portFlagFor(text: string | undefined, port: number): string | null {
  const line = (text ?? '').trim();
  if (!line || NAMES_A_PORT.test(line)) return null;
  for (const tool of PORT_FLAG_TOOLS) {
    if (tool.pattern.test(line)) return tool.flag(port);
  }
  return null;
}

/**
 * How a command is expected to learn its port.
 *
 * `flag` means it takes one on the command line, `env` means it is a server that
 * conventionally reads `PORT`, and `none` means it must be left alone — either
 * because it already names a port of its own (a project's configured number is
 * its own decision, not something to silently correct) or because it takes no
 * port at all. A `none` keeps whatever port it chooses, and the preview simply
 * follows the address it prints.
 */
export function portStrategy(text: string | undefined, kind: DevServerKind): 'flag' | 'env' | 'none' {
  const line = (text ?? '').trim();
  if (!line || NAMES_A_PORT.test(line)) return 'none';
  if (portFlagFor(line, 1) !== null) return 'flag';
  return kind === 'server' ? 'env' : 'none';
}
