import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '../src/renderer/stores/agentStore';
import { useProjectStore } from '../src/renderer/stores/projectStore';

/**
 * The dead end this guards against: press Enter with no project open, get a
 * native alert, and watch the run never happen. The prompt is now held instead
 * and released as soon as a folder exists.
 */

function installBridge() {
  const startAgent = vi.fn(async () => true);
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.electronAPI = { startAgent };
  return { startAgent };
}

const resetStores = () => {
  useAgentStore.setState({
    prompt: '',
    timeline: [],
    sessionId: null,
    pendingSend: null,
    status: 'idle',
    mode: 'build'
  });
  useProjectStore.setState({ projectPath: null });
};

describe('a prompt sent with no project open', () => {
  let alertSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    alertSpy = vi.fn();
    (globalThis as any).alert = alertSpy;
  });

  it('is held for the project picker instead of dropped', async () => {
    const { startAgent } = installBridge();
    useAgentStore.setState({ prompt: 'หาเทสต์ที่พังแล้วแก้ให้ผ่าน' });

    await useAgentStore.getState().startAgent();

    expect(startAgent).not.toHaveBeenCalled();
    expect(useAgentStore.getState().pendingSend?.text).toBe('หาเทสต์ที่พังแล้วแก้ให้ผ่าน');
    // Nothing ran, so the transcript must stay empty and the draft must survive.
    expect(useAgentStore.getState().timeline).toEqual([]);
    expect(useAgentStore.getState().prompt).toBe('หาเทสต์ที่พังแล้วแก้ให้ผ่าน');
  });

  it('never raises a blocking native dialog', async () => {
    installBridge();
    useAgentStore.setState({ prompt: 'hello' });

    await useAgentStore.getState().startAgent();

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps attached images with the held prompt', async () => {
    installBridge();
    const images = [{ name: 'shot.png', dataUrl: 'data:image/png;base64,AAA' }];

    await useAgentStore.getState().startAgent('ดูภาพนี้', images as any);

    expect(useAgentStore.getState().pendingSend?.images).toHaveLength(1);
  });

  it('is sent once a folder has been chosen', async () => {
    const { startAgent } = installBridge();
    useAgentStore.setState({ prompt: 'อธิบายโปรเจกต์นี้' });
    await useAgentStore.getState().startAgent();
    expect(useAgentStore.getState().pendingSend).not.toBeNull();

    useProjectStore.setState({ projectPath: 'F:\\D4IDE' });
    await useAgentStore.getState().resumePendingSend();

    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(startAgent.mock.calls[0][0]).toMatchObject({ prompt: 'อธิบายโปรเจกต์นี้', projectPath: 'F:\\D4IDE' });
    expect(useAgentStore.getState().pendingSend).toBeNull();
    expect(useAgentStore.getState().prompt).toBe('');
    expect(useAgentStore.getState().timeline.some((item) => item.content === 'อธิบายโปรเจกต์นี้')).toBe(true);
  });

  it('stops waiting once the user declines', async () => {
    installBridge();
    useAgentStore.setState({ prompt: 'ไว้ก่อน' });
    await useAgentStore.getState().startAgent();

    useAgentStore.getState().clearPendingSend();

    expect(useAgentStore.getState().pendingSend).toBeNull();
    // Declining must not eat the message the user wrote.
    expect(useAgentStore.getState().prompt).toBe('ไว้ก่อน');
  });
});
