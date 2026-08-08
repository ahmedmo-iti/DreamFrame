import { describe, expect, it } from 'vitest';
import { parseHistoryPayload, parseQueuePayload, formatBytes, formatClock } from '../src/lib/comfyQueue';
import type { RenderWorker } from '../src/lib/renderWorkers';

const worker: RenderWorker = { id: 'main-pc', name: 'Main PC', apiBase: '/worker/main-pc/comfy' };

const taggedPrompt = {
  '3': { class_type: 'KSampler', inputs: { seed: 12 } },
  '108': { class_type: 'VHS_VideoCombine', inputs: { filename_prefix: 'video/dreamframe' } },
};

const dreamframeExtra = {
  dreamframe: { workflow: 'shot', title: 'Shot Editor sequence', shotTitle: 'Opening Shot', shotIndex: 0, totalShots: 3 },
};

describe('parseQueuePayload', () => {
  it('reads running and pending entries out of ComfyUI positional tuples', () => {
    const tasks = parseQueuePayload(worker, {
      queue_running: [[7, 'prompt-running', taggedPrompt, dreamframeExtra, []]],
      queue_pending: [[8, 'prompt-pending', taggedPrompt, dreamframeExtra, []]],
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe('running');
    expect(tasks[0].promptId).toBe('prompt-running');
    expect(tasks[0].queueNumber).toBe(7);
    expect(tasks[0].id).toBe('main-pc:prompt-running');
    expect(tasks[1].status).toBe('queued');
  });

  it('names a DreamFrame prompt from its own tag and counts its nodes', () => {
    const [task] = parseQueuePayload(worker, {
      queue_running: [[1, 'p1', taggedPrompt, dreamframeExtra, []]],
    });

    expect(task.title).toBe('Opening Shot');
    expect(task.subtitle).toContain('shot sequence');
    expect(task.subtitle).toContain('shot 1 of 3');
    expect(task.external).toBe(false);
    expect(task.nodeCount).toBe(2);
  });

  it('still surfaces a prompt queued outside DreamFrame, named from its graph', () => {
    const [task] = parseQueuePayload(worker, {
      queue_pending: [[1, 'p2', { '1': { class_type: 'WanVideoSampler', inputs: {} } }, {}, []]],
    });

    expect(task.external).toBe(true);
    expect(task.title).toBe('External WAN video job');
  });

  it('ignores malformed entries instead of throwing', () => {
    const tasks = parseQueuePayload(worker, {
      queue_running: [null, [], ['only-number'], [1, '', {}, {}, []]],
      queue_pending: 'not-an-array',
    });

    expect(tasks).toEqual([]);
  });
});

describe('parseHistoryPayload', () => {
  it('takes start and finish times from the status messages', () => {
    const [task] = parseHistoryPayload(worker, {
      'p-done': {
        prompt: [1, 'p-done', taggedPrompt, dreamframeExtra, []],
        outputs: {},
        status: {
          status_str: 'success',
          completed: true,
          messages: [
            ['execution_start', { prompt_id: 'p-done', timestamp: 1_000_000 }],
            ['execution_success', { prompt_id: 'p-done', timestamp: 1_042_000 }],
          ],
        },
      },
    });

    expect(task.status).toBe('done');
    expect(task.startedAt).toBe(1_000_000);
    expect(task.finishedAt).toBe(1_042_000);
  });

  it('reports a failed prompt with the node that raised', () => {
    const [task] = parseHistoryPayload(worker, {
      'p-bad': {
        prompt: [1, 'p-bad', taggedPrompt, dreamframeExtra, []],
        status: {
          status_str: 'error',
          completed: false,
          messages: [
            ['execution_error', { exception_message: 'Allocation on device', node_type: 'KSampler', traceback: ['line 1\n'] }],
          ],
        },
      },
    });

    expect(task.status).toBe('failed');
    expect(task.errorMessage).toBe('Allocation on device in KSampler');
    expect(task.errorDetail).toBe('line 1\n');
  });

  it('treats an incomplete prompt with no error as cancelled', () => {
    const [task] = parseHistoryPayload(worker, {
      'p-stop': {
        prompt: [1, 'p-stop', taggedPrompt, dreamframeExtra, []],
        status: { status_str: 'success', completed: false, messages: [] },
      },
    });

    expect(task.status).toBe('cancelled');
  });

  it('orders the newest finish first', () => {
    const item = (id: string, at: number) => ({
      prompt: [1, id, taggedPrompt, dreamframeExtra, []],
      status: {
        status_str: 'success',
        completed: true,
        messages: [['execution_success', { timestamp: at }]],
      },
    });
    const tasks = parseHistoryPayload(worker, { old: item('old', 10), fresh: item('fresh', 99) });

    expect(tasks.map((task) => task.promptId)).toEqual(['fresh', 'old']);
  });
});

describe('formatters', () => {
  it('formats a clock past the hour', () => {
    expect(formatClock(45)).toBe('0:45');
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(3_725)).toBe('1:02:05');
    expect(formatClock(-1)).toBe('0:00');
  });

  it('formats bytes as gigabytes and says nothing when it cannot', () => {
    expect(formatBytes(8 * 1024 ** 3)).toBe('8.0 GB');
    expect(formatBytes(undefined)).toBe('—');
  });
});
