import {
  DreamFrameTask,
  WorkerMachineStats,
  fetchMachineStats,
  fetchWorkerHistory,
  fetchWorkerQueue,
} from './comfyQueue';
import { loadRenderWorkers, RenderWorker } from './renderWorkers';

export interface TaskProgress {
  percent: number;
  label?: string;
  node?: string;
  updatedAt: number;
}

export interface TaskState {
  tasks: DreamFrameTask[];
  machines: WorkerMachineStats[];
  /** Keyed by promptId. ComfyUI sends progress only to the socket that queued the prompt, so
   *  the running render publishes here; anything queued elsewhere shows state without a bar. */
  progress: Record<string, TaskProgress>;
  ready: boolean;
  error?: string;
}

const QUEUE_INTERVAL_MS = 2000;
const SLOW_INTERVAL_MS = 6000;
/** With every render PC down, polling on the fast cadence is a failed request every 2 s
 *  for as long as the tab is open. Back off instead, and snap back the moment one answers. */
const MAX_BACKOFF = 6;

let state: TaskState = { tasks: [], machines: [], progress: {}, ready: false };
let listeners = new Set<() => void>();
let subscriberCount = 0;
let queueTimer: number | undefined;
let slowTimer: number | undefined;
let workers: RenderWorker[] = [];
let workersLoadedAt = 0;
let historyByWorker: Record<string, DreamFrameTask[]> = {};
let queueByWorker: Record<string, DreamFrameTask[]> = {};
let backoff = 1;

function emit(next: Partial<TaskState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function mergeTasks(): DreamFrameTask[] {
  const live = Object.values(queueByWorker).flat();
  const liveIds = new Set(live.map((task) => task.id));
  // A prompt can appear in both lists for a moment as it finishes; the queue wins while it is there.
  const finished = Object.values(historyByWorker).flat().filter((task) => !liveIds.has(task.id));
  return [...live, ...finished];
}

async function refreshWorkers(force = false) {
  const stale = Date.now() - workersLoadedAt > 30_000;
  if (!force && workers.length > 0 && !stale) return;
  try {
    const response = await loadRenderWorkers();
    workers = response.workers;
    workersLoadedAt = Date.now();
  } catch (error) {
    emit({ error: error instanceof Error ? error.message : 'Could not read the render PC list.' });
  }
}

async function pollQueues() {
  await refreshWorkers();
  if (workers.length === 0) {
    emit({ ready: true });
    return;
  }
  const results = await Promise.all(
    workers.map(async (worker) => {
      try {
        return { worker, tasks: await fetchWorkerQueue(worker), error: undefined as string | undefined };
      } catch (error) {
        return {
          worker,
          tasks: [] as DreamFrameTask[],
          error: error instanceof Error ? error.message : 'Queue unavailable',
        };
      }
    }),
  );
  queueByWorker = Object.fromEntries(results.map((result) => [result.worker.id, result.tasks]));
  const reachable = results.some((result) => !result.error);
  backoff = reachable ? 1 : Math.min(MAX_BACKOFF, backoff + 1);
  emit({
    tasks: mergeTasks(),
    ready: true,
    error: reachable
      ? undefined
      : 'No render PC is reachable. Start ComfyUI and this page picks the queue back up on its own.',
  });
}

async function pollSlow() {
  await refreshWorkers();
  if (workers.length === 0) return;
  const [histories, machines] = await Promise.all([
    Promise.all(
      workers.map(async (worker) => {
        try {
          return [worker.id, await fetchWorkerHistory(worker)] as const;
        } catch {
          return [worker.id, historyByWorker[worker.id] ?? []] as const;
        }
      }),
    ),
    Promise.all(workers.map((worker) => fetchMachineStats(worker))),
  ]);
  historyByWorker = Object.fromEntries(histories);
  emit({ tasks: mergeTasks(), machines });
}

let running = false;

function scheduleQueue() {
  if (!running) return;
  queueTimer = window.setTimeout(async () => {
    await pollQueues();
    scheduleQueue();
  }, QUEUE_INTERVAL_MS * backoff);
}

function scheduleSlow() {
  if (!running) return;
  slowTimer = window.setTimeout(async () => {
    await pollSlow();
    scheduleSlow();
  }, SLOW_INTERVAL_MS * backoff);
}

function start() {
  if (running) return;
  running = true;
  // Backoff deliberately survives a stop/start: it tracks whether the render PCs answer, which
  // a component remounting does not change. StrictMode alone cycles this twice on every mount.
  void pollQueues().then(scheduleQueue);
  void pollSlow().then(scheduleSlow);
}

function stop() {
  running = false;
  if (queueTimer != null) window.clearTimeout(queueTimer);
  if (slowTimer != null) window.clearTimeout(slowTimer);
  queueTimer = undefined;
  slowTimer = undefined;
}

export function subscribeToTasks(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount += 1;
  if (subscriberCount === 1) start();
  return () => {
    listeners.delete(listener);
    subscriberCount -= 1;
    if (subscriberCount === 0) stop();
  };
}

export function getTaskSnapshot(): TaskState {
  return state;
}

export function refreshTasksNow(): void {
  backoff = 1;
  void pollQueues();
  void pollSlow();
}

/** Called by the running render, which owns the only socket ComfyUI reports progress to. */
export function publishTaskProgress(promptId: string, percent: number, label?: string, node?: string): void {
  if (!promptId) return;
  emit({
    progress: {
      ...state.progress,
      [promptId]: { percent: Math.max(0, Math.min(100, percent)), label, node, updatedAt: Date.now() },
    },
  });
}

export function clearTaskProgress(promptId: string): void {
  if (!promptId || !state.progress[promptId]) return;
  const next = { ...state.progress };
  delete next[promptId];
  emit({ progress: next });
}

export function activeTaskCount(snapshot: TaskState = state): number {
  return snapshot.tasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
}
