/**
 * Deciding what the preview panel should show.
 *
 * Kept out of the panel component so the rules can be tested on their own: the
 * preview opens by itself when the agent starts a web server, and guessing the
 * port wrong is the difference between a working panel and a blank frame.
 */

/** Commands that serve a web app on a local port. */
export const DEV_SERVER_COMMAND =
  /(?:\b(?:npm|pnpm|yarn|bun)\b[^\n]*\b(?:run\s+)?(?:dev|start|serve|preview)\b)|\b(?:vite|next\s+dev|nuxt\s+dev|astro\s+dev|webpack\s+serve|http-server|serve\s+-[a-z])\b/i;

/** True when a terminal command looks like it starts a local web server. */
export function startsDevServer(command: string): boolean {
  return DEV_SERVER_COMMAND.test(command);
}

/**
 * The address a dev-server command will answer on, when the command names one.
 * Returns null when the port has to be discovered by probing instead.
 */
export function devServerUrlFromCommand(command: string): string | null {
  if (!DEV_SERVER_COMMAND.test(command)) return null;
  const portMatch =
    command.match(/--port[= ](\d{2,5})/) ||
    command.match(/(?:^|\s)-p\s+(\d{2,5})/) ||
    command.match(/-H[^\n]*?:(\d{4,5})/) ||
    command.match(/localhost:(\d{2,5})/);
  const port = portMatch ? portMatch[1] : null;
  return port ? `http://localhost:${port}` : null;
}

/**
 * Local origins only. The preview panel is where the user's own app is served;
 * it is not a general-purpose browser, and a remote URL inside the frame would
 * quietly turn it into one.
 */
export function isLocalUrl(url: string): boolean {
  // The host has to *end* there: "localhost.evil.com" starts with a local name
  // but is somebody else's server, and must not be loaded into the frame.
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)/i.test(url);
}
