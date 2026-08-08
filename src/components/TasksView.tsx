import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Cpu,
  Film,
  Layers,
  ListOrdered,
  Loader2,
  MonitorCog,
  PanelsTopLeft,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import {
  DreamFrameTask,
  WorkerMachineStats,
  clearWorkerHistory,
  formatBytes,
  formatClock,
  formatTimeOfDay,
  interruptWorker,
  removeQueuedPrompt,
} from '../lib/comfyQueue';
import { getTaskSnapshot, refreshTasksNow, subscribeToTasks, TaskState } from '../lib/taskStore';

function useTasks(): TaskState {
  return useSyncExternalStore(subscribeToTasks, getTaskSnapshot, getTaskSnapshot);
}

function workflowIcon(workflow?: string) {
  if (workflow === '3d') return Box;
  if (workflow === 'model') return Layers;
  if (workflow === 'storyboard') return PanelsTopLeft;
  return Film;
}

function Meter({ label, value, percent, tone }: { label: string; value: string; percent: number; tone?: 'warn' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-[9px] font-mono uppercase tracking-[0.16em] text-white/38">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <span
          className={`block h-full rounded-full transition-all duration-500 ${tone === 'warn' ? 'bg-amber-300' : 'bg-white'}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="shrink-0 text-[10px] font-mono text-white/60">{value}</span>
    </div>
  );
}

function StatTile({ label, value, note, icon: Icon }: {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/42">{label}</div>
        <div className="rounded-xl border border-white/10 bg-black/25 p-2 text-white/70"><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-4 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-white/42">{note}</div>
    </div>
  );
}

interface ActiveCardProps {
  task: DreamFrameTask;
  percent?: number;
  now: number;
  onStop: (task: DreamFrameTask) => void;
}

const ActiveCard: React.FC<ActiveCardProps> = ({ task, percent, now, onStop }) => {
  const Icon = workflowIcon(task.tag?.workflow);
  const running = task.status === 'running';
  const elapsed = task.startedAt ? (now - task.startedAt) / 1000 : 0;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-4 rounded-2xl border p-4 ${running ? 'border-cyan-300/20 bg-cyan-500/[0.05]' : 'border-white/10 bg-white/[0.025]'}`}
    >
      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${running ? 'border-cyan-300/20 bg-black/40 text-cyan-100' : 'border-white/10 bg-black/40 text-white/45'}`}>
        {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h3 className="truncate text-sm font-bold text-white">{task.title}</h3>
          {task.external && (
            <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-2 py-0.5 text-[8px] font-mono uppercase tracking-[0.14em] text-amber-100">
              not from DreamFrame
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-white/38">
          {task.subtitle} · {task.workerName}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className={`text-xs font-bold ${running ? 'text-cyan-100' : 'text-white/55'}`}>
            {running ? 'working' : 'waiting its turn'}
          </span>
          {running && percent != null && (
            <span className="text-[10px] font-mono text-white/40">{Math.round(percent)}%</span>
          )}
          {running && percent == null && (
            <span className="text-[10px] font-mono text-white/35">progress reported to the tab that started it</span>
          )}
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/8">
          {running && (percent != null
            ? <div className="h-full bg-white transition-all duration-500" style={{ width: `${percent}%` }} />
            : <div className="h-full w-1/3 animate-pulse rounded-full bg-white/40" />)}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-white/38">
          {running ? (
            <>
              {task.startedAt ? <span className="text-white/70">{formatClock(elapsed)} elapsed</span> : null}
              <span>{task.nodeCount} nodes</span>
            </>
          ) : (
            <>
              <span>queued {formatTimeOfDay(task.tag?.queuedAt)}</span>
              <span>starts when the one above finishes</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col justify-center">
        <button
          type="button"
          onClick={() => onStop(task)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] text-white/60 transition-all hover:border-rose-300/25 hover:bg-rose-500/10 hover:text-rose-200"
        >
          <X className="h-3 w-3" />{running ? 'stop' : 'remove'}
        </button>
      </div>
    </motion.article>
  );
};

interface FinishedRowProps {
  task: DreamFrameTask;
  expanded: boolean;
  onToggle: () => void;
}

const FinishedRow: React.FC<FinishedRowProps> = ({ task, expanded, onToggle }) => {
  const Icon = workflowIcon(task.tag?.workflow);
  const duration = task.startedAt && task.finishedAt ? (task.finishedAt - task.startedAt) / 1000 : undefined;
  const tone = task.status === 'failed'
    ? 'text-rose-200'
    : task.status === 'cancelled' ? 'text-amber-200' : 'text-emerald-200';
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/45">
          {task.status === 'failed' ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : <Icon className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-white">{task.title}</div>
          <div className="mt-0.5 truncate text-[10px] font-mono uppercase tracking-[0.14em] text-white/35">
            {task.subtitle} · {task.workerName}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-mono uppercase tracking-[0.14em] ${tone}`}>
            {task.status === 'done' ? 'finished' : task.status}
          </div>
          <div className="mt-0.5 text-[10px] font-mono text-white/35">
            {formatTimeOfDay(task.finishedAt)}{duration != null ? ` · ${formatClock(duration)}` : ''}
          </div>
        </div>
      </div>

      {task.status === 'failed' && task.errorMessage && (
        <div className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-100/85">
          {task.errorMessage}
          {task.errorDetail && (
            <button type="button" onClick={onToggle} className="ml-2 underline decoration-rose-300/40 underline-offset-2 hover:text-white">
              {expanded ? 'hide details' : 'details'}
            </button>
          )}
        </div>
      )}
      {expanded && task.errorDetail && (
        <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 text-[10px] leading-relaxed text-white/60">
          {task.errorDetail}
        </pre>
      )}

      {task.outputFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.outputFiles.slice(0, 6).map((file) => (
            <a
              key={`${file.type}:${file.subfolder}:${file.filename}`}
              href={file.url}
              download={file.filename}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.12em] text-white/60 hover:bg-white/[0.09] hover:text-white"
            >
              {file.extension}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

const MachinePanel: React.FC<{ machine: WorkerMachineStats }> = ({ machine }) => {
  const vramUsed = machine.vramTotalBytes && machine.vramFreeBytes != null
    ? machine.vramTotalBytes - machine.vramFreeBytes
    : undefined;
  const vramPercent = machine.vramTotalBytes && vramUsed != null ? (vramUsed / machine.vramTotalBytes) * 100 : 0;
  const ramUsed = machine.ramTotalBytes && machine.ramFreeBytes != null
    ? machine.ramTotalBytes - machine.ramFreeBytes
    : undefined;
  const ramPercent = machine.ramTotalBytes && ramUsed != null ? (ramUsed / machine.ramTotalBytes) * 100 : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-white">{machine.workerName}</div>
          <div className="mt-0.5 truncate text-[10px] font-mono uppercase tracking-[0.13em] text-white/35">
            {machine.online ? machine.deviceName : machine.error || 'unreachable'}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-mono uppercase tracking-[0.12em] ${machine.online ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200' : 'border-rose-300/20 bg-rose-400/10 text-rose-200'}`}>
          {machine.online ? 'online' : 'offline'}
        </span>
      </div>

      {machine.online && (
        <div className="mt-3 flex flex-col gap-2">
          {machine.vramTotalBytes ? (
            <Meter
              label="VRAM"
              percent={vramPercent}
              tone={vramPercent > 90 ? 'warn' : undefined}
              value={`${formatBytes(vramUsed)} / ${formatBytes(machine.vramTotalBytes)}`}
            />
          ) : null}
          {machine.ramTotalBytes ? (
            <Meter label="RAM" percent={ramPercent} value={`${formatBytes(ramUsed)} / ${formatBytes(machine.ramTotalBytes)}`} />
          ) : null}
          {machine.comfyVersion && (
            <div className="text-[10px] font-mono text-white/30">ComfyUI {machine.comfyVersion}</div>
          )}
        </div>
      )}
    </div>
  );
};

export const TasksView: React.FC = () => {
  const { tasks, machines, progress, ready, error } = useTasks();
  const [now, setNow] = useState(() => Date.now());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const running = useMemo(() => tasks.filter((task) => task.status === 'running'), [tasks]);
  const queued = useMemo(
    () => tasks.filter((task) => task.status === 'queued').sort((a, b) => (a.queueNumber ?? 0) - (b.queueNumber ?? 0)),
    [tasks],
  );
  const finished = useMemo(
    () => tasks.filter((task) => !['running', 'queued'].includes(task.status)).slice(0, 25),
    [tasks],
  );
  const activeCount = running.length + queued.length;

  useEffect(() => {
    if (activeCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  const stopTask = async (task: DreamFrameTask) => {
    setBusy(true);
    try {
      if (task.status === 'running') await interruptWorker({ apiBase: task.apiBase });
      else await removeQueuedPrompt({ apiBase: task.apiBase }, task.promptId);
      refreshTasksNow();
    } catch (stopError) {
      window.alert(stopError instanceof Error ? stopError.message : 'Could not stop that task.');
    } finally {
      setBusy(false);
    }
  };

  const clearFinished = async () => {
    setBusy(true);
    const seen = new Set<string>();
    for (const task of finished) {
      if (seen.has(task.apiBase)) continue;
      seen.add(task.apiBase);
      await clearWorkerHistory({ apiBase: task.apiBase });
    }
    refreshTasksNow();
    setBusy(false);
  };

  const latest = finished.find((task) => task.outputFiles.some((file) => file.extension === 'mp4' || file.extension === 'webm'));
  const latestVideo = latest?.outputFiles.find((file) => file.extension === 'mp4' || file.extension === 'webm');
  const onlineMachines = machines.filter((machine) => machine.online).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      <section className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03)_36%,rgba(12,12,18,0.96)_74%)] p-6 shadow-2xl shadow-black/40 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(129,140,248,0.16),transparent_30%)]" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.22em] text-white/55">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                <ListOrdered className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />
                Live ComfyUI queue
              </span>
              <span>{machines.length} render PC{machines.length === 1 ? '' : 's'} watched</span>
            </div>
            <h1 className="mt-4 font-grotesk text-3xl font-black tracking-tight text-white sm:text-5xl">Tasks</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/62 sm:text-[15px]">
              Everything your render PCs are making, in the order they will make it. Read straight from each
              ComfyUI queue, so it survives a reload and shows work started from any tab. No time estimate is
              shown — the same shot can take minutes or hours depending on what else holds the card.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => refreshTasksNow()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-xs font-bold tracking-[0.16em] text-white/75 hover:bg-white/[0.09] hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />REFRESH
            </button>
            {finished.length > 0 && (
              <button
                type="button"
                onClick={() => void clearFinished()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold tracking-[0.16em] text-black hover:bg-neutral-200 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />CLEAR FINISHED
              </button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Running" value={String(running.length)} note="On the card now" icon={Loader2} />
        <StatTile label="Waiting" value={String(queued.length)} note="Queued behind it" icon={ListOrdered} />
        <StatTile label="Finished" value={String(finished.length)} note="Recent history" icon={CheckCircle2} />
        <StatTile label="Render PCs" value={`${onlineMachines}/${machines.length}`} note="Online now" icon={Server} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <section className="rounded-[28px] border border-white/12 bg-neutral-950/70 p-4 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">Queue</div>
              <div className="text-[10px] font-mono uppercase tracking-[0.14em] text-white/35">
                {activeCount === 0 ? 'nothing running' : `${activeCount} in progress`}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {!ready && <div className="py-10 text-center text-xs font-mono text-white/35">Reading the queue…</div>}
              {ready && activeCount === 0 && (
                <div className="rounded-2xl border border-dashed border-white/12 py-14 text-center" role="status">
                  <ListOrdered className="mx-auto mb-3 h-8 w-8 text-white/18" />
                  <h3 className="text-sm font-bold text-white/80">Nothing is being made right now</h3>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-white/40">
                    Start a shot sequence, a storyboard or a 3D workflow and it appears here.
                  </p>
                </div>
              )}
              {running.map((task) => (
                <ActiveCard key={task.id} task={task} now={now} percent={progress[task.promptId]?.percent} onStop={(t) => void stopTask(t)} />
              ))}
              {queued.map((task) => (
                <ActiveCard key={task.id} task={task} now={now} onStop={(t) => void stopTask(t)} />
              ))}
              {queued.length > 1 && (
                <p className="px-1 text-[10px] leading-relaxed text-white/30">
                  ComfyUI runs its queue in the order it was given and offers no way to reorder it. A task can be
                  removed and queued again, which puts it at the back.
                </p>
              )}
            </div>
          </section>

          {finished.length > 0 && (
            <section className="rounded-[28px] border border-white/12 bg-neutral-950/70 p-4 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">Finished</div>
                <div className="text-[10px] font-mono text-white/35">{finished.length}</div>
              </div>
              <div className="flex flex-col gap-2">
                {finished.map((task) => (
                  <FinishedRow
                    key={task.id}
                    task={task}
                    expanded={expandedId === task.id}
                    onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section className="overflow-hidden rounded-[28px] border border-white/12 bg-neutral-950/70 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="border-b border-white/10 px-5 py-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
              Latest output
            </div>
            <div className="flex h-64 items-center justify-center bg-black">
              {latestVideo ? (
                <video src={latestVideo.url} controls playsInline className="h-full w-full object-contain" aria-label="Most recent finished output" />
              ) : (
                <div className="px-6 text-center">
                  <Film className="mx-auto mb-3 h-8 w-8 text-white/15" />
                  <div className="text-xs font-bold text-white/60">No finished video yet</div>
                  <div className="mt-1 text-[11px] text-white/35">The most recent completed render shows here.</div>
                </div>
              )}
            </div>
            {latest && (
              <div className="border-t border-white/10 px-5 py-3">
                <div className="truncate text-xs font-bold text-white">{latest.title}</div>
                <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.13em] text-white/35">
                  {latest.workerName} · {formatTimeOfDay(latest.finishedAt)}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-white/12 bg-neutral-950/70 p-5 shadow-xl shadow-black/20 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
              <MonitorCog className="h-3.5 w-3.5" />These machines
            </div>
            <div className="flex flex-col gap-3">
              {machines.length === 0 && (
                <div className="text-xs font-mono text-white/35">No render PC has answered yet.</div>
              )}
              {machines.map((machine) => <MachinePanel key={machine.workerId} machine={machine} />)}
            </div>
            <div className="mt-4 flex gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[10px] leading-relaxed text-white/38">
              <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                VRAM and RAM come from each ComfyUI's own report. GPU load and temperature are not part of that
                report, so they are not shown rather than guessed.
              </span>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
};
