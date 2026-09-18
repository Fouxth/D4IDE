import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { shell } from 'electron';
import { USER_AGENT } from '../../shared/version';
import { AuthProfile, AuthProvider, AuthState, DeviceCodePrompt } from '../../shared/types';
import { keyStorage } from '../security/key-storage';

/**
 * Sign-in for D4IDE: GitHub or Google, nothing else (spec §7).
 *
 * Both flows are the desktop-safe kind — no client *secret* is ever shipped or
 * asked for, because a secret inside an installed app is not a secret:
 *
 *   · GitHub uses the Device Flow. The user is shown a short code, approves it
 *     on github.com, and the app polls for the token. Only a public client id
 *     is needed.
 *   · Google uses Authorization Code + PKCE over a loopback redirect. The
 *     browser does the sign-in; the code comes back to `127.0.0.1` and is
 *     exchanged with the verifier. Only a public client id is needed.
 *
 * The resulting token is stored encrypted (DPAPI on Windows via `safeStorage`)
 * in the data folder, and the profile — not the token — is what the UI shows.
 */

export type { AuthProfile, AuthProvider, AuthState, DeviceCodePrompt };

export interface StoredSession {
  provider: AuthProvider;
  profile: AuthProfile;
  signedInAt: number;
  /** Encrypted access token. */
  token: string;
  /** Encrypted refresh token (Google only). */
  refreshToken?: string;
  expiresAt?: number;
}

/** Google's desktop clients accept any loopback port, so we let the OS pick one. */
export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API = 'https://api.github.com';
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const AUTH_CALLBACK_TIMEOUT_MS = 5 * 60_000;

export const base64url = (input: Buffer): string =>
  input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The PKCE pair: the verifier stays local, only its hash goes to Google. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildGoogleAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', options.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Reads the identity out of Google's id_token (a JWT we do not need to verify). */
export function decodeIdToken(idToken: string): { sub: string; name?: string; email?: string; picture?: string } | null {
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload?.sub) return null;
    return { sub: String(payload.sub), name: payload.name, email: payload.email, picture: payload.picture };
  } catch {
    return null;
  }
}

/** GitHub's device-code response, in the shape the flow needs. */
export function parseDeviceCodeResponse(body: any, now = Date.now()): DeviceCodePrompt | null {
  const deviceCode = body?.device_code;
  const userCode = body?.user_code;
  const verificationUri = body?.verification_uri;
  if (!deviceCode || !userCode || !verificationUri) return null;
  return {
    userCode: String(userCode),
    verificationUri: String(verificationUri),
    expiresAt: now + (Number(body.expires_in) || 900) * 1000,
    intervalMs: Math.max(1, Number(body.interval) || 5) * 1000
  };
}

/** How long to wait before the next device-flow poll, honouring `slow_down`. */
export function nextPollDelay(intervalMs: number, attempt: number): number {
  return Math.min(intervalMs + attempt * 1000, 30_000);
}

/** Keeps the sign-in inside the time the flow was granted. */
export function deviceCodeExpired(prompt: DeviceCodePrompt, now = Date.now()): boolean {
  return now > prompt.expiresAt;
}

export class AuthService {
  private session: StoredSession | null = null;
  private readonly file: string;

  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, 'auth.json');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoredSession;
      if (!parsed?.profile?.provider) return;
      this.session = parsed;
    } catch (e) {
      console.warn('[D4IDE] Could not read the saved sign-in:', e);
    }
  }

  private persist(): void {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      if (!this.session) {
        fs.rmSync(this.file, { force: true });
        return;
      }
      fs.writeFileSync(this.file, JSON.stringify(this.session, null, 2), 'utf8');
    } catch (e) {
      console.warn('[D4IDE] Could not save the sign-in:', e);
    }
  }

  getState(options: { required: boolean; githubClientId?: string; googleClientId?: string }): AuthState {
    return {
      signedIn: !!this.session,
      profile: this.session?.profile ?? null,
      signedInAt: this.session?.signedInAt,
      githubReady: !!options.githubClientId,
      googleReady: !!options.googleClientId,
      required: options.required
    };
  }

  hasSession(): boolean {
    return !!this.session;
  }

  /** The live token, for callers that need to act as the signed-in user. */
  getToken(): string | null {
    if (!this.session?.token) return null;
    return keyStorage.decrypt(this.session.token) || null;
  }

  signOut(): void {
    this.session = null;
    this.persist();
  }

  /**
   * Re-checks the stored session against the provider. A token that has been
   * revoked must not keep the app unlocked, so a rejected token signs out.
   */
  async verify(): Promise<AuthState> {
    if (!this.session) return { signedIn: false, profile: null, githubReady: false, googleReady: false, required: false };

    if (this.session.provider === 'github') {
      const token = this.getToken();
      if (!token) {
        this.signOut();
        return { signedIn: false, profile: null, githubReady: false, googleReady: false, required: false };
      }
      try {
        const response = await fetch(`${GITHUB_API}/user`, {
          headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' }
        });
        if (response.status === 401) {
          this.signOut();
          return { signedIn: false, profile: null, githubReady: false, googleReady: false, required: false };
        }
      } catch {
        // Offline: an unreachable provider is not proof the token is bad, so the
        // session stands rather than forcing a sign-in every time the net drops.
      }
    }

    return {
      signedIn: true,
      profile: this.session.profile,
      signedInAt: this.session.signedInAt,
      githubReady: false,
      googleReady: false,
      required: false
    };
  }

  /** GitHub Device Flow. `onPrompt` gets the code the user must enter. */
  async signInWithGithub(clientId: string, onPrompt: (prompt: DeviceCodePrompt) => void): Promise<AuthProfile> {
    const start = await this.postForm(GITHUB_DEVICE_CODE_URL, { client_id: clientId, scope: 'read:user user:email' });
    const prompt = parseDeviceCodeResponse(start);
    if (!prompt) throw new Error('GitHub did not return a device code. Check the client ID.');
    onPrompt(prompt);

    let attempt = 0;
    while (!deviceCodeExpired(prompt)) {
      await new Promise((resolve) => setTimeout(resolve, nextPollDelay(prompt.intervalMs, attempt)));
      attempt++;

      const body = await this.postForm(GITHUB_TOKEN_URL, {
        client_id: clientId,
        device_code: (start as any).device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      });

      if (body?.access_token) {
        const profile = await this.fetchGithubProfile(String(body.access_token));
        this.session = {
          provider: 'github',
          profile,
          signedInAt: Date.now(),
          token: keyStorage.encrypt(String(body.access_token))
        };
        this.persist();
        return profile;
      }

      const error = String(body?.error || '');
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        attempt += 2;
        continue;
      }
      if (error === 'expired_token') throw new Error('The code expired before it was approved. Try again.');
      if (error === 'access_denied') throw new Error('Sign-in was cancelled on GitHub.');
      if (error === 'device_flow_disabled') {
        throw new Error('Device Flow is disabled for this GitHub app — enable it in the app settings.');
      }
      if (error) throw new Error(`GitHub sign-in failed: ${error}`);
    }

    throw new Error('The GitHub code expired. Try again.');
  }

  /** Google Authorization Code + PKCE over a loopback redirect. */
  async signInWithGoogle(clientId: string, onUrl: (url: string) => void): Promise<AuthProfile> {
    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomBytes(16).toString('hex');
    const server = http.createServer();
    const port: number = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not open a loopback port for the redirect.'));
      });
    });

    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const authUrl = buildGoogleAuthUrl({ clientId, redirectUri, challenge, state });
    onUrl(authUrl);

    try {
      const code = await this.waitForCallback(server, state);
      const token = await this.postForm(GOOGLE_TOKEN_URL, {
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      });
      if (!token?.access_token) {
        throw new Error(`Google refused the sign-in: ${token?.error_description || token?.error || 'no token'}`);
      }

      const identity = token.id_token ? decodeIdToken(String(token.id_token)) : null;
      const profile: AuthProfile = {
        provider: 'google',
        id: identity?.sub || String(token.access_token).slice(-12),
        login: identity?.email || 'google-user',
        name: identity?.name || identity?.email || 'Google user',
        email: identity?.email,
        avatarUrl: identity?.picture
      };

      this.session = {
        provider: 'google',
        profile,
        signedInAt: Date.now(),
        token: keyStorage.encrypt(String(token.access_token)),
        refreshToken: token.refresh_token ? keyStorage.encrypt(String(token.refresh_token)) : undefined,
        expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : undefined
      };
      this.persist();
      return profile;
    } finally {
      server.close();
    }
  }

  /** Resolves with the authorization code the browser hands back. */
  private waitForCallback(server: http.Server, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const finish = (error: Error | null, code?: string) => {
        clearTimeout(timer);
        server.removeAllListeners('request');
        if (error) reject(error);
        else resolve(code as string);
      };

      const timer = setTimeout(
        () => finish(new Error('The sign-in window timed out before it was completed.')),
        AUTH_CALLBACK_TIMEOUT_MS
      );

      server.on('request', (request, response) => {
        const url = new URL(request.url || '/', `http://127.0.0.1`);
        if (url.pathname !== '/callback') {
          response.writeHead(404).end();
          return;
        }

        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        // A code that arrives with the wrong state did not come from our request.
        if (error || !code || state !== expectedState) {
          response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          response.end(callbackPage('Sign-in failed', 'You can close this tab and try again in D4IDE.'));
          finish(new Error(error ? `Google returned: ${error}` : 'The sign-in response did not match this request.'));
          return;
        }

        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(callbackPage('Signed in to D4IDE', 'You can close this tab and return to the app.'));
        finish(null, code);
      });
    });
  }

  private async fetchGithubProfile(token: string): Promise<AuthProfile> {
    const headers = { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' };
    const user = await (await fetch(`${GITHUB_API}/user`, { headers })).json();

    // A private email is not on /user; the dedicated endpoint is authoritative.
    let email: string | undefined = user?.email || undefined;
    if (!email) {
      try {
        const emails = await (await fetch(`${GITHUB_API}/user/emails`, { headers })).json();
        if (Array.isArray(emails)) {
          email = emails.find((entry: any) => entry.primary)?.email || emails[0]?.email;
        }
      } catch {
        // Email is optional; the login name is enough to identify the account.
      }
    }

    return {
      provider: 'github',
      id: String(user?.id ?? user?.login ?? ''),
      login: String(user?.login ?? 'github-user'),
      name: String(user?.name || user?.login || 'GitHub user'),
      email,
      avatarUrl: user?.avatar_url
    };
  }

  private async postForm(url: string, form: Record<string, string>): Promise<any> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams(form).toString()
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      // GitHub answers form-encoded when JSON is not acceptable; parse that too.
      const params = new URLSearchParams(text);
      return Object.fromEntries(params.entries());
    }
  }
}

/** The tiny page shown in the browser tab after a Google redirect. */
const callbackPage = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0b0d;color:#e7e7ea;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  div{border:1px solid #2a2a2f;background:#141417;padding:28px 32px;border-radius:12px;text-align:center}
  h1{font-size:16px;margin:0 0 6px}p{font-size:13px;color:#9a9aa2;margin:0}</style></head>
  <body><div><h1>${title}</h1><p>${body}</p></div></body></html>`;
