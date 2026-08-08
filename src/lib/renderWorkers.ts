export type RenderWorkerStatus = 'checking' | 'online' | 'offline';

export interface RenderWorker {
  id: string;
  name: string;
  apiBase: string;
  isLocal?: boolean;
  status?: RenderWorkerStatus;
  deviceName?: string;
  vramTotalBytes?: number;
  vramFreeBytes?: number;
  error?: string;
}

export interface RenderWorkerListResponse {
  workers: RenderWorker[];
  configFile?: string;
}

export async function loadRenderWorkers(signal?: AbortSignal): Promise<RenderWorkerListResponse> {
  const response = await fetch('/dreamframe/workers', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load render PCs (${response.status}).`);
  const payload = await response.json();
  return {
    workers: Array.isArray(payload?.workers) ? payload.workers : [],
    configFile: typeof payload?.configFile === 'string' ? payload.configFile : undefined,
  };
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

export async function inspectRenderWorker(worker: RenderWorker, signal?: AbortSignal): Promise<RenderWorker> {
  try {
    const response = await fetch(`${worker.apiBase}/system_stats`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const device = Array.isArray(payload?.devices) ? payload.devices[0] : undefined;
    return {
      ...worker,
      status: 'online',
      deviceName: String(device?.name || device?.type || 'GPU worker'),
      vramTotalBytes: firstNumber(device?.vram_total, device?.vram_total_bytes),
      vramFreeBytes: firstNumber(device?.vram_free, device?.vram_free_bytes),
      error: undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return {
      ...worker,
      status: 'offline',
      error: error instanceof Error ? error.message : 'Worker unavailable',
    };
  }
}

export async function loadAndInspectRenderWorkers(signal?: AbortSignal): Promise<RenderWorkerListResponse> {
  const response = await loadRenderWorkers(signal);
  const workers = await Promise.all(response.workers.map((worker) => inspectRenderWorker({ ...worker, status: 'checking' }, signal)));
  return { ...response, workers };
}

export function formatVram(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return 'VRAM unknown';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
