import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * A keyed provider must never be remembered as keyless just because the OS
 * keychain was not usable yet.
 *
 * `safeStorage` throws for every decrypt before `app.whenReady()`, and the store
 * is read during startup — so the *first* `getProviders()` of a launch reads
 * every key as empty. That answer used to be cached under the providers file's
 * stamp, which made the empty keys permanent for the whole process: requests
 * went out with no `Authorization` header, the catalogue check skipped every
 * keyed provider, and the UI called a working provider "needs a key" until the
 * user edited something on disk.
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-key-decrypt-test-'));
process.env.APPDATA = testRoot;

/** Mutable state the mocked keychain reads, so a test can open it mid-flight. */
/**
 * `ready` = the app has finished starting (keychain usable).
 * `reject` = the keychain is up but refuses this ciphertext, which is what a
 * rotated OS keyring looks like from the inside.
 */
const keychain = vi.hoisted(() => ({ ready: true, reject: false }));

vi.mock('electron', () => ({
  app: {
    // `ready` doubles as "app.whenReady() has run": the store treats a decrypt
    // failure before that as timing and the same failure after it as dead data.
    isReady: () => keychain.ready,
    getPath: () => {
      throw new Error('app is not ready in tests');
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`enc:${plaintext}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      if (!keychain.ready) {
        throw new Error('safeStorage cannot be used before app is ready');
      }
      if (keychain.reject) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      }
      return buffer.toString('utf8').replace(/^enc:/, '');
    }
  }
}));

const { appStore } = await import('../src/main/database/store');

const PROVIDER_ID = 'custom_keychain_endpoint';
const SECRET = 'sk-live-secret-9876';

const seed = () => {
  keychain.ready = true;
  appStore.saveProviders([
    {
      id: PROVIDER_ID,
      name: 'Keychain Endpoint',
      type: 'custom',
      enabled: true,
      baseUrl: 'https://api.example.com/v1',
      requiresApiKey: true,
      apiKey: SECRET,
      models: []
    } as any
  ]);
};

const read = () => appStore.getProviders().find((p) => p.id === PROVIDER_ID)!;

beforeAll(() => {
  appStore.saveSettings({ removedProviderIds: [], activeProviderId: PROVIDER_ID, activeModelId: 'x' });
  // Prove the key really is stored encrypted on disk, not in plaintext.
  seed();
  const onDisk = JSON.parse(fs.readFileSync(path.join(testRoot, 'D4IDE', 'D4IDE_DATA', 'providers.json'), 'utf8'));
  expect(JSON.stringify(onDisk)).not.toContain(SECRET);
  expect(onDisk.find((p: any) => p.id === PROVIDER_ID).apiKey).toMatch(/^dpapi:/);
});

afterAll(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('provider keys — an unready keychain is not a missing key', () => {
  it('does not cache the keyless answer, so the key is there on the next read', () => {
    keychain.ready = false;
    const duringStartup = read();
    expect(duringStartup.apiKey).toBe('');
    expect(duringStartup.hasApiKey).toBe(false);
    // Not yet readable is our timing, so it is not reported as the user's fault.
    expect(duringStartup.keyUnreadable).toBe(false);

    keychain.ready = true;
    const afterReady = read();
    expect(afterReady.apiKey).toBe(SECRET);
    expect(afterReady.hasApiKey).toBe(true);
    expect(afterReady.keyUnreadable).toBe(false);
  });

  it('says so when a stored key will not decrypt after startup, instead of calling it missing', () => {
    seed();
    keychain.reject = true;
    const unreadable = read();
    keychain.reject = false;

    expect(unreadable.apiKey).toBe('');
    expect(unreadable.hasApiKey).toBe(false);
    // Not "no key on file" — a key is on file and is now useless.
    expect(unreadable.keyUnreadable).toBe(true);
    expect(unreadable.status).toBe('error');
    expect(appStore.isFreshError(unreadable)).toBe(true);
  });

  it('remembers the unreadable verdict instead of re-reading the file on every request', () => {
    seed();
    keychain.reject = true;
    expect(read().keyUnreadable).toBe(true);
    // Still true now that the keychain would answer, proving it was remembered.
    keychain.reject = false;
    expect(read().keyUnreadable).toBe(true);

    seed();
    expect(read().keyUnreadable).toBe(false);
  });

  it('never destroys a stored key just because a read could not decrypt it', () => {
    seed();
    keychain.ready = false;
    const blockedRead = read();
    expect(blockedRead.apiKey).toBe('');
    // A save that touches other fields must not write the empty key back.
    appStore.saveProviders([{ ...blockedRead, name: 'Renamed Endpoint' } as any]);

    keychain.ready = true;
    const after = read();
    expect(after.name).toBe('Renamed Endpoint');
    expect(after.apiKey).toBe(SECRET);
  });

  it('keeps reporting the key even while the keychain is closed again', () => {
    // The successful read is cached: a later keychain outage (locked vault) does
    // not retroactively blank a key that was already read.
    keychain.ready = false;
    expect(read().apiKey).toBe(SECRET);
    keychain.ready = true;
  });

  it('reports a provider whose key was removed as keyless, with no retry', () => {
    // Deleting a key is explicit. An empty `apiKey` on its own means "I did not
    // touch this key", which is what keeps a failed read from wiping it.
    seed();
    keychain.ready = false;
    appStore.saveProviders(
      [{ id: PROVIDER_ID, name: 'Keychain Endpoint', type: 'custom', enabled: true, baseUrl: 'https://api.example.com/v1', requiresApiKey: true, apiKey: '', models: [] } as any],
      { clearKeys: [PROVIDER_ID] }
    );
    const cleared = read();
    expect(cleared.hasApiKey).toBe(false);
    expect(cleared.keyUnreadable).toBe(false);
    keychain.ready = true;
    seed();
    expect(read().hasApiKey).toBe(true);
  });
});
