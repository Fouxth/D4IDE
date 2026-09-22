import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueueStore } from '../src/renderer/stores/queueStore';
import { useAgentStore } from '../src/renderer/stores/agentStore';
import { AgentStatus } from '../src/shared/types';

/**
 * Queue state (spec §16, §90). The queue decides when an agent run starts, so a
 * mistake here either runs work the user paused or strands the queue forever —
 * both are tested explicitly rather than only the happy path.
 *
 * The agent store is stubbed because a real `startAgent` talks to the main
 * process over IPC, which does not exist in a unit test; what matters here is
 * that the queue asks it to run exactly the right prompt, at the right moment.
 */
const startAgent = vi.fn(async () => undefined);
const setMode = vi.fn();
const updateStatus = vi.fn();

const queue = () => useQueueStore.getState();

const seedAgent = (status: AgentStatus) => {
  useAgentStore.setState({ status, startAgent, setMode, updateStatus } as never);
};

beforeEach(() => {
  startAgent.mockClear();
  setMode.mockClear();
  updateStatus.mockClear();
  useQueueStore.setState({ items: [], autoRun: true });
  seedAgent('idle');
});

describe('queue items', () => {
  it('appends each task with its own mode and a unique id', () => {
    const first = queue().addItem('fix the build', 'build');
    const second = queue().addItem('review the diff', 'plan');

    expect(queue().items.map((i) => i.prompt)).toEqual(['fix the build', 'review the diff']);
    expect(queue().items.map((i) => i.mode)).toEqual(['build', 'plan']);
    expect(queue().items.every((i) => i.status === 'queued')).toBe(true);
    expect(first.id).not.toBe(second.id);
  });

  it('removes and patches a single item by id', () => {
    const keep = queue().addItem('keep me', 'build');
    const drop = queue().addItem('drop me', 'build');

    queue().updateItem(keep.id, { prompt: 'edited' });
    queue().removeItem(drop.id);

    expect(queue().items).toHaveLength(1);
    expect(queue().items[0].prompt).toBe('edited');
  });

  it('moves an item one step and refuses to move past either end', () => {
    const a = queue().addItem('a', 'build');
    const b = queue().addItem('b', 'build');
    const c = queue().addItem('c', 'build');

    queue().moveItem(c.id, -1);
    expect(queue().items.map((i) => i.prompt)).toEqual(['a', 'c', 'b']);

    queue().moveItem(a.id, -1); // already first — must be a no-op
    queue().moveItem(b.id, 1); // already last — must be a no-op
    expect(queue().items.map((i) => i.prompt)).toEqual(['a', 'c', 'b']);
  });

  it('reorders by index and ignores an out-of-range start', () => {
    const ids = ['a', 'b', 'c', 'd'].map((p) => queue().addItem(p, 'build').id);

    queue().reorderItems(0, 2);
    expect(queue().items.map((i) => i.prompt)).toEqual(['b', 'c', 'a', 'd']);
    expect(queue().items.map((i) => i.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);

    queue().reorderItems(9, 0);
    expect(queue().items.map((i) => i.prompt)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('queue running', () => {
  it('starts the first queued task with that task\'s mode', () => {
    queue().addItem('first', 'plan');
    queue().addItem('second', 'build');

    queue().runNext();

    expect(setMode).toHaveBeenCalledWith('plan');
    expect(startAgent).toHaveBeenCalledWith('first', undefined);
    expect(queue().items[0].status).toBe('running');
    expect(queue().items[1].status).toBe('queued');
  });

  // A queued message keeps its pictures: sending the words without the
  // screenshot they referred to is a different message.
  it('carries the images attached when the task was queued', () => {
    const image = { id: 'img_1', name: 'shot.png', mimeType: 'image/png', data: 'AAAA', bytes: 3 };
    queue().addItem('look at this', 'build', [image]);

    queue().runNext();

    expect(startAgent).toHaveBeenCalledWith('look at this', [image]);
  });

  it('does not advance while the queue is paused', () => {
    queue().addItem('wait', 'build');
    queue().pauseAll();

    queue().runNext();

    expect(startAgent).not.toHaveBeenCalled();
    expect(queue().items[0].status).toBe('paused');
  });

  it('pauses only waiting tasks, leaving the running one alone', () => {
    queue().addItem('running', 'build');
    queue().addItem('waiting', 'build');
    queue().runNext();

    queue().pauseAll();

    expect(queue().items.map((i) => i.status)).toEqual(['running', 'paused']);
    expect(queue().autoRun).toBe(false);
  });

  it('resumes paused tasks and immediately picks the queue back up', () => {
    queue().addItem('one', 'build');
    queue().addItem('two', 'build');
    queue().pauseAll();
    seedAgent('idle');

    queue().resumeAll();

    expect(queue().autoRun).toBe(true);
    expect(queue().items.map((i) => i.status)).toEqual(['running', 'queued']);
    expect(startAgent).toHaveBeenCalledWith('one', undefined);
  });

  it('marks finished work by the terminal status the agent reported', () => {
    queue().addItem('a', 'build');
    queue().addItem('b', 'build');
    queue().runNext();

    queue().settleRunning('failed');

    expect(queue().items[0].status).toBe('failed');
    expect(queue().items[0].finishedAt).toBeTypeOf('number');
    expect(queue().items[1].status).toBe('queued');
  });

  it('completes a running task by hand and tells the agent it is done', () => {
    queue().addItem('a', 'build');
    queue().runNext();
    updateStatus.mockClear();

    queue().markDone(queue().items[0].id);

    expect(queue().items[0].status).toBe('completed');
    expect(updateStatus).toHaveBeenCalledWith('completed');
  });

  it('re-queues a failed task for retry and clears its error', () => {
    const item = queue().addItem('a', 'build');
    queue().runNext();
    queue().settleRunning('failed');
    queue().updateItem(item.id, { error: 'boom' });

    queue().retryItem(item.id);

    expect(queue().items[0]).toMatchObject({ status: 'queued', error: undefined, finishedAt: undefined });
  });

  it('runs a specific item out of order', () => {
    queue().addItem('first', 'plan');
    const second = queue().addItem('second', 'build');

    queue().runItem(second.id);

    expect(setMode).toHaveBeenCalledWith('build');
    expect(startAgent).toHaveBeenCalledWith('second', undefined);
    expect(queue().items[0].status).toBe('queued');
    expect(queue().items[1].status).toBe('running');
  });

  it('clears finished work but keeps everything still in flight', () => {
    queue().addItem('done', 'build');
    queue().addItem('failed', 'build');
    queue().addItem('paused', 'build');
    queue().addItem('queued', 'build');

    const [done, failed, paused] = queue().items.map((i) => i.id);
    queue().updateItem(done, { status: 'completed' });
    queue().updateItem(failed, { status: 'cancelled' });
    queue().updateItem(paused, { status: 'paused' });

    queue().clearFinished();

    expect(queue().items.map((i) => i.prompt)).toEqual(['paused', 'queued']);
  });
});
