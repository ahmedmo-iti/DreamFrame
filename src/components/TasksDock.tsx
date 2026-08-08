import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, CheckCircle2, ListOrdered, Loader2, X } from 'lucide-react';
import { formatClock, formatTimeOfDay } from '../lib/comfyQueue';
import { getTaskSnapshot, subscribeToTasks } from '../lib/taskStore';

interface TasksDockProps {
  hidden?: boolean;
  onOpenTasks: () => void;
}

/**
 * The glance over your work. The Tasks page owns the full queue; this stays out of the way and
 * answers one question — is the render still alive — without costing you the screen you are on.
 */
export const TasksDock: React.FC<TasksDockProps> = ({ hidden = false, onOpenTasks }) => {
  const { tasks, progress } = useSyncExternalStore(subscribeToTasks, getTaskSnapshot, getTaskSnapshot);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const running = useMemo(() => tasks.filter((task) => task.status === 'running'), [tasks]);
  const queued = useMemo(() => tasks.filter((task) => task.status === 'queued'), [tasks]);
  const recent = useMemo(
    () => tasks.filter((task) => !['running', 'queued'].includes(task.status)).slice(0, 4),
    [tasks],
  );
  const active = running.length + queued.length;

  useEffect(() => {
    if (active === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (hidden) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Current tasks"
            className="fixed bottom-24 right-5 z-50 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-white/15 bg-[#08080a]/97 shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/55">
                <ListOrdered className="h-3.5 w-3.5 text-violet-300" />
                {active > 0 ? `${active} in progress` : 'nothing running'}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close tasks panel"
                className="rounded-lg bg-white/5 p-1.5 text-white/55 hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            <div className="max-h-[50vh] overflow-y-auto p-3">
              {active === 0 && recent.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-white/35">
                  Start a workflow and it shows up here.
                </p>
              )}

              {[...running, ...queued].map((task) => {
                const percent = task.status === 'running' ? progress[task.promptId]?.percent : undefined;
                const elapsed = task.startedAt ? (now - task.startedAt) / 1000 : 0;
                return (
                  <div key={task.id} className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 last:mb-0">
                    <div className="flex items-center gap-2">
                      {task.status === 'running'
                        ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-200" />
                        : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" />}
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">{task.title}</span>
                      {task.status === 'running' && task.startedAt ? (
                        <span className="shrink-0 text-[10px] font-mono text-white/45">{formatClock(elapsed)}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-[10px] font-mono uppercase tracking-[0.12em] text-white/32">
                      {task.workerName}{task.status === 'queued' ? ' · waiting' : ''}
                    </div>
                    {task.status === 'running' && (
                      <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-white/10">
                        {percent != null
                          ? <div className="h-full bg-white transition-all duration-500" style={{ width: `${percent}%` }} />
                          : <div className="h-full w-1/3 animate-pulse bg-white/40" />}
                      </div>
                    )}
                  </div>
                );
              })}

              {recent.length > 0 && (
                <>
                  <div className="mb-1.5 mt-3 px-1 text-[9px] font-mono uppercase tracking-[0.18em] text-white/30">Recent</div>
                  {recent.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 px-1 py-1.5">
                      <CheckCircle2 className={`h-3 w-3 shrink-0 ${task.status === 'done' ? 'text-emerald-300/70' : 'text-rose-300/70'}`} />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-white/60">{task.title}</span>
                      <span className="shrink-0 text-[9px] font-mono text-white/28">{formatTimeOfDay(task.finishedAt)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <footer className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => { setOpen(false); onOpenTasks(); }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-black hover:bg-neutral-200"
              >
                Open Tasks <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={active > 0 ? `Show tasks, ${active} in progress` : 'Show tasks'}
          className="fixed bottom-6 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-full border border-white/15 bg-[#0c0c11]/95 p-3.5 text-white/80 shadow-2xl shadow-black/60 backdrop-blur-xl transition-all hover:scale-105 hover:border-white/30 hover:text-white"
        >
          {active > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <ListOrdered className="h-5 w-5" />}
          {active > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-black/40 bg-violet-500 px-1 text-[10px] font-mono font-bold text-white">
              {active}
            </span>
          )}
        </button>
      )}
    </>
  );
};
