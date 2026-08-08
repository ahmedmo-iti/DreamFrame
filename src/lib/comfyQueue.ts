import type { ComfyOutputFile } from './comfyApi';
import { extractOutputFiles } from './comfyApi';
import type { RenderWorker } from './renderWorkers';

export type TaskStatus = 'running' | 'queued' | 'done' | 'failed' | 'cancelled';

/**
 * DreamFrame stamps its own prompts through `extra_data` so the queue can be read back with
 * real titles. ComfyUI echoes extra_data in /queue and /history untouched, which is the only
 * way a browser-side client can recognise its own work among everything else on the card.
 */
export interface TaskTag {
  projectId?: string;
  workflow?: string;
  title?: string;
  shotTitle?: string;
  shotIndex?: number;
  totalShots?: number;
  queuedAt?: number;
}

export interface DreamFrameTask {
  id: string;
  promptId: string;
  workerId: string;
  workerName: string;
  apiBase: string;
  status: TaskStatus;
  title: string;
  subtitle: string;
  external: boolean;
  tag?: TaskTag;
  nodeCount: number;
  queueNumber?: number;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  errorDetail?: string;
  outputFiles: ComfyOutputFile[];
  prompt?: Record<string, unknown>;
}

export interface WorkerMachineStats {
  workerId: string;
  workerName: string;
  online: boolean;
  deviceName?: string;
  vramTotalBytes?: number;
  vramFreeBytes?: number;
  ramTotalBytes?: number;
  ramFreeBytes?: number;
  comfyVersion?: string;
  queueRemaining?: number;
  error?: string;
}

const HISTORY_LIMIT = 20;

const ENGINE_HINTS: Array<[RegExp, string]> = [
  [/wan/i, 'WAN video'],
  [/trellis/i, 'TRELLIS 3D'],
  [/sharp|moge|gaussian/i, 'Gaussian reconstruction'],
  [/ipadapter/i, 'Storyboard'],
  [/vace/i, 'Video edit'],
  [/sam2|segment/i, 'Segmentation'],
  [/iclight/i, 'Relight'],
  [/upscale|esrgan/i, 'Upscale'],
];

export const WORKFLOW_LABEL: Record<string, string> = {
  shot: 'shot sequence',
  storyboard: 'storyboard animatic',
  model: '3D model',
  '3d': 'Gaussian splat',
};

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : undefined;
}

function readTag(extraData: unknown): TaskTag | undefined {
  const tag = asRecord(asRecord(extraData)?.dreamframe);
  if (!tag) return undefined;
  return {
    projectId: typeof tag.projectId === 'string' ? tag.projectId : undefined,
    workflow: typeof tag.workflow === 'string' ? tag.workflow : undefined,
    title: typeof tag.title === 'string' ? tag.title : undefined,
    shotTitle: typeof tag.shotTitle === 'string' ? tag.shotTitle : undefined,
    shotIndex: Number.isFinite(Number(tag.shotIndex)) ? Number(tag.shotIndex) : undefined,
    totalShots: Number.isFinite(Number(tag.totalShots)) ? Number(tag.totalShots) : undefined,
    queuedAt: Number.isFinite(Number(tag.queuedAt)) ? Number(tag.queuedAt) : undefined,
  };
}

/** A prompt DreamFrame did not queue still occupies the card, so it is named, not hidden. */
function describeForeignGraph(prompt: Record<string, any> | undefined): string {
  if (!prompt) return 'External ComfyUI job';
  const haystack = Object.values(prompt)
    .map((node) => {
      const record = asRecord(node);
      const classType = String(record?.class_type ?? '');
      const inputs = Object.values(asRecord(record?.inputs) ?? {})
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
      return `${classType} ${inputs}`;
    })
    .join(' ');
  const hit = ENGINE_HINTS.find(([pattern]) => pattern.test(haystack));
  return hit ? `External ${hit[1]} job` : 'External ComfyUI job';
}

function messageTimestamp(messages: unknown, wanted: string[]): number | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const entry of messages) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    if (!wanted.includes(String(entry[0]))) continue;
    const stamp = Number(asRecord(entry[1])?.timestamp);
    if (Number.isFinite(stamp) && stamp > 0) return stamp;
  }
  return undefined;
}

function executionError(messages: unknown): { message: string; detail?: string } | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const entry of messages) {
    if (!Array.isArray(entry) || String(entry[0]) !== 'execution_error') continue;
    const data = asRecord(entry[1]) ?? {};
    const nodeType = data.node_type ? ` in ${data.node_type}` : '';
    return {
      message: `${String(data.exception_message || data.exception_type || 'ComfyUI reported an execution error')}${nodeType}`,
      detail: Array.isArray(data.traceback) ? data.traceback.join('') : undefined,
    };
  }
  return undefined;
}

function baseTask(
  worker: RenderWorker,
  promptId: string,
  prompt: Record<string, any> | undefined,
  extraData: unknown,
  status: TaskStatus,
): DreamFrameTask {
  const tag = readTag(extraData);
  const shotSuffix = tag?.shotIndex != null && tag?.totalShots
    ? `shot ${tag.shotIndex + 1} of ${tag.totalShots}`
    : undefined;
  const workflowLabel = tag?.workflow ? WORKFLOW_LABEL[tag.workflow] || tag.workflow : undefined;
  return {
    id: `${worker.id}:${promptId}`,
    promptId,
    workerId: worker.id,
    workerName: worker.name,
    apiBase: worker.apiBase,
    status,
    title: tag?.shotTitle || tag?.title || describeForeignGraph(prompt),
    subtitle: [workflowLabel, shotSuffix].filter(Boolean).join(' · ') || `${worker.name}`,
    external: !tag,
    tag,
    nodeCount: prompt ? Object.keys(prompt).length : 0,
    outputFiles: [],
    prompt,
  };
}

/** Queue entries are positional tuples: [number, promptId, prompt, extraData, outputsToExecute]. */
function fromQueueEntry(worker: RenderWorker, entry: unknown, status: TaskStatus): DreamFrameTask | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const promptId = String(entry[1] ?? '');
  if (!promptId) return null;
  const task = baseTask(worker, promptId, asRecord(entry[2]), entry[3], status);
  const number = Number(entry[0]);
  if (Number.isFinite(number)) task.queueNumber = number;
  if (status === 'running') task.startedAt = task.tag?.queuedAt;
  return task;
}

export function parseQueuePayload(worker: RenderWorker, payload: unknown): DreamFrameTask[] {
  const record = asRecord(payload);
  const running = Array.isArray(record?.queue_running) ? record.queue_running : [];
  const pending = Array.isArray(record?.queue_pending) ? record.queue_pending : [];
  return [
    ...running.map((entry: unknown) => fromQueueEntry(worker, entry, 'running')),
    ...pending.map((entry: unknown) => fromQueueEntry(worker, entry, 'queued')),
  ].filter((task): task is DreamFrameTask => task !== null);
}

export async function fetchWorkerQueue(worker: RenderWorker, signal?: AbortSignal): Promise<DreamFrameTask[]> {
  const response = await fetch(`${worker.apiBase}/queue`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Queue unavailable on ${worker.name} (HTTP ${response.status}).`);
  return parseQueuePayload(worker, await response.json());
}

export async function fetchWorkerHistory(worker: RenderWorker, signal?: AbortSignal): Promise<DreamFrameTask[]> {
  const response = await fetch(`${worker.apiBase}/history?max_items=${HISTORY_LIMIT}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`History unavailable on ${worker.name} (HTTP ${response.status}).`);
  return parseHistoryPayload(worker, await response.json());
}

export function parseHistoryPayload(worker: RenderWorker, payload: unknown): DreamFrameTask[] {
  const record = asRecord(payload);
  if (!record) return [];

  const tasks: DreamFrameTask[] = [];
  for (const [promptId, rawItem] of Object.entries(record)) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const promptTuple = Array.isArray(item.prompt) ? item.prompt : [];
    const status = asRecord(item.status);
    const messages = status?.messages;
    const failure = executionError(messages);
    const errored = failure != null || status?.status_str === 'error';
    // A prompt that started and never reported success was interrupted rather than broken.
    const started = messageTimestamp(messages, ['execution_start']);
    const finished = messageTimestamp(messages, ['execution_success', 'execution_error', 'execution_interrupted']);
    const interrupted = !errored && status?.completed === false;

    const task = baseTask(
      worker,
      promptId,
      asRecord(promptTuple[2]),
      promptTuple[3],
      errored ? 'failed' : interrupted ? 'cancelled' : 'done',
    );
    task.startedAt = started;
    task.finishedAt = finished;
    task.errorMessage = failure?.message ?? (errored ? 'ComfyUI reported that this workflow failed.' : undefined);
    task.errorDetail = failure?.detail;
    task.outputFiles = extractOutputFiles(item, worker.apiBase);
    tasks.push(task);
  }
  return tasks.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}

export async function fetchMachineStats(worker: RenderWorker, signal?: AbortSignal): Promise<WorkerMachineStats> {
  try {
    const response = await fetch(`${worker.apiBase}/system_stats`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const system = asRecord(payload?.system);
    const device = Array.isArray(payload?.devices) ? asRecord(payload.devices[0]) : undefined;
    return {
      workerId: worker.id,
      workerName: worker.name,
      online: true,
      deviceName: String(device?.name || device?.type || 'GPU'),
      vramTotalBytes: Number(device?.vram_total) || undefined,
      vramFreeBytes: Number(device?.vram_free) || undefined,
      ramTotalBytes: Number(system?.ram_total) || undefined,
      ramFreeBytes: Number(system?.ram_free) || undefined,
      comfyVersion: system?.comfyui_version ? String(system.comfyui_version) : undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return {
      workerId: worker.id,
      workerName: worker.name,
      online: false,
      error: error instanceof Error ? error.message : 'Worker unreachable',
    };
  }
}

/** Stops the prompt ComfyUI is executing right now on this worker. */
export async function interruptWorker(worker: { apiBase: string }, signal?: AbortSignal): Promise<void> {
  await fetch(`${worker.apiBase}/interrupt`, { method: 'POST', signal }).catch(() => undefined);
}

/** Drops a prompt that has not started. ComfyUI exposes no reorder, only removal. */
export async function removeQueuedPrompt(
  worker: { apiBase: string },
  promptId: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${worker.apiBase}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
    signal,
  });
  if (!response.ok) throw new Error(`Could not remove that task (HTTP ${response.status}).`);
}

export async function clearWorkerHistory(worker: { apiBase: string }, signal?: AbortSignal): Promise<void> {
  await fetch(`${worker.apiBase}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true }),
    signal,
  }).catch(() => undefined);
}

export function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '—';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function formatTimeOfDay(epochMs?: number): string {
  if (!epochMs || !Number.isFinite(epochMs)) return '';
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
