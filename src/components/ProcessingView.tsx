import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Box, CheckCircle2, Film, Layers, Loader2, PanelsTopLeft, Play, RotateCcw, Server, X } from 'lucide-react';
import { WorkflowCreationType } from '../types';
import { DistributedShotUpdate, GenerationProgress } from '../lib/comfyApi';

interface ProcessingViewProps {
  workflow: WorkflowCreationType;
  sourceImage: string;
  progress: GenerationProgress;
  error?: string;
  manualShotControl?: { currentIndex: number; totalShots: number; title: string } | null;
  distributedShotControls?: DistributedShotUpdate[];
  onRunCurrentShot?: () => void;
  onRunDistributedShot?: (index: number) => void;
  onRunAllReadyShots?: () => void;
  onCancelDistributedShot?: (index: number) => void;
  onCancel: () => void;
  onBack: () => void;
}

export const ProcessingView: React.FC<ProcessingViewProps> = ({ workflow, sourceImage, progress, error, manualShotControl, distributedShotControls = [], onRunCurrentShot, onRunDistributedShot, onRunAllReadyShots, onCancelDistributedShot, onCancel, onBack }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const interval = window.setInterval(() => setElapsedSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const Icon = workflow === '3d' ? Box : workflow === 'model' || workflow === 'mesh' ? Layers : workflow === 'storyboard' ? PanelsTopLeft : Film;
  const engine = workflow === '3d' ? 'APPLE SHARP + MOGE-2' : workflow === 'shot' ? 'WAN 2.2 IMAGE-TO-VIDEO' : workflow === 'storyboard' ? 'SDXL + IPADAPTER' : 'TRELLIS.2';
  const canPreview = sourceImage && !/^data:application\/(octet-stream|x-exr)/i.test(sourceImage);
  const readyShotCount = distributedShotControls.filter((shot) => shot.status === 'ready').length;
  const completedShotCount = distributedShotControls.filter((shot) => shot.status === 'completed').length;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }} className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="dreamframe-card p-6 sm:p-8 flex flex-col gap-6 shadow-2xl relative overflow-hidden">
        <div className={`relative w-full rounded-2xl overflow-hidden bg-[#08080a] border border-white/10 ${distributedShotControls.length > 0 ? 'h-[620px] sm:h-[700px]' : 'h-[400px] sm:h-[460px]'}`}>
          {canPreview && <img src={sourceImage} alt="Source input" className="absolute inset-0 h-full w-full object-cover blur-xl scale-110 opacity-20" />}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.16),rgba(0,0,0,0.88)_65%)]" />

          {!error ? (
            <div className={`absolute inset-0 flex flex-col items-center p-8 text-center ${distributedShotControls.length > 0 ? 'justify-start overflow-y-auto' : 'justify-center'}`} role="status" aria-live="polite">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl">
                <Icon className="h-9 w-9 text-white/75" aria-hidden="true" />
                <Loader2 className="absolute -right-2 -top-2 h-7 w-7 animate-spin rounded-full bg-black p-1.5 text-white" aria-hidden="true" />
              </div>
              <div className="mt-6 text-[10px] font-mono uppercase tracking-[0.26em] text-white/35">Local ComfyUI Render</div>
              <h2 className="mt-2 max-w-xl text-xl font-bold text-white">{progress.status}</h2>
              <p className="mt-2 text-xs font-mono text-white/45">{engine}</p>
              <div className="mt-3 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[10px] font-mono text-white/45">RENDER TIME {elapsedLabel}</div>
              <div className="mt-7 w-full max-w-md">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-white transition-all duration-500" style={{ width: `${progress.percent}%` }} /></div>
                <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-white/40"><span>PROCESSING</span><span>{progress.percent}%</span></div>
              </div>

              {workflow === 'shot' && manualShotControl && distributedShotControls.length === 0 && !error && (
                <div className="mt-6 w-full max-w-xl rounded-2xl border border-violet-300/15 bg-white/[0.04] p-4 text-left shadow-xl shadow-black/20">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-violet-200/65">Manual shot control</div>
                      <h3 className="mt-1 text-sm font-bold text-white">Shot {manualShotControl.currentIndex + 1} of {manualShotControl.totalShots} · {manualShotControl.title}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/48">This sequence is waiting for your cue. Run this shot when you are ready, or cancel the sequence.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={onRunCurrentShot}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-black transition-all hover:bg-neutral-200 active:scale-95"
                      >
                        <Film className="h-3.5 w-3.5" /> Run shot
                      </button>
                      <button
                        onClick={onCancel}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/14 bg-white/[0.04] px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-white/80 transition-all hover:border-white/30 hover:bg-white/[0.08] hover:text-white active:scale-95"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel sequence
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {workflow === 'shot' && distributedShotControls.length > 0 && !error && (
                <div className="mt-6 w-full max-w-3xl rounded-2xl border border-cyan-300/15 bg-black/35 p-4 text-left shadow-xl shadow-black/20">
                  <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-100/65"><Server className="h-3.5 w-3.5" /> Multi-PC render queue</div>
                      <h3 className="mt-1 text-sm font-bold text-white">{completedShotCount} of {distributedShotControls.length} shots completed</h3>
                      <p className="mt-1 text-xs leading-relaxed text-white/44">Ready shots can run at the same time on different PCs. Dependent shots unlock after the previous continuity frame is available.</p>
                    </div>
                    <button
                      type="button"
                      onClick={onRunAllReadyShots}
                      disabled={readyShotCount === 0}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-mono font-bold uppercase tracking-[0.12em] text-black transition-all hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
                    >
                      <Play className="h-3.5 w-3.5" /> Run all ready ({readyShotCount})
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {distributedShotControls.map((shot) => {
                      const isReady = shot.status === 'ready';
                      const isRunning = shot.status === 'running';
                      const canCancel = isReady || isRunning || shot.status === 'blocked';
                      return (
                        <div key={shot.index} className={`rounded-xl border p-3 ${shot.status === 'completed' ? 'border-emerald-300/18 bg-emerald-500/[0.055]' : shot.status === 'failed' || shot.status === 'cancelled' ? 'border-rose-300/18 bg-rose-500/[0.055]' : isRunning ? 'border-cyan-300/18 bg-cyan-500/[0.055]' : 'border-white/10 bg-white/[0.025]'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/35">Shot {shot.index + 1} · {shot.workerName}</div>
                              <div className="mt-1 truncate text-xs font-bold text-white">{shot.title}</div>
                            </div>
                            <span className={`rounded-full border px-2 py-1 text-[8px] font-mono uppercase tracking-[0.12em] ${shot.status === 'completed' ? 'border-emerald-300/20 text-emerald-200' : shot.status === 'failed' || shot.status === 'cancelled' ? 'border-rose-300/20 text-rose-200' : isRunning ? 'border-cyan-300/20 text-cyan-100' : 'border-white/10 text-white/55'}`}>{shot.status}</span>
                          </div>
                          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8"><div className="h-full bg-white transition-all duration-300" style={{ width: `${Math.max(0, Math.min(100, shot.percent))}%` }} /></div>
                          <p className="mt-2 min-h-8 text-[10px] leading-relaxed text-white/42 line-clamp-2">{shot.message}</p>
                          <div className="mt-3 flex items-center gap-2">
                            {isReady && (
                              <button type="button" onClick={() => onRunDistributedShot?.(shot.index)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-black hover:bg-neutral-200"><Play className="h-3 w-3" /> Run shot</button>
                            )}
                            {shot.status === 'completed' && <div className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-300/15 bg-emerald-500/10 px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-emerald-200"><CheckCircle2 className="h-3 w-3" /> Complete</div>}
                            {isRunning && <div className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-cyan-300/15 bg-cyan-500/10 px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-cyan-100"><Loader2 className="h-3 w-3 animate-spin" /> Rendering</div>}
                            {canCancel && <button type="button" onClick={() => onCancelDistributedShot?.(shot.index)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-white/65 hover:border-rose-300/25 hover:bg-rose-500/10 hover:text-rose-200"><X className="h-3 w-3" /> Cancel</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-8" role="alert">
              <div className="max-w-2xl rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-center">
                <AlertTriangle className="w-8 h-8 mx-auto text-red-300 mb-3" />
                <h2 className="text-xl font-black text-white mb-2">Preflight or local workflow failed</h2>
                <p className="font-mono text-xs leading-relaxed text-red-100/80 whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-1 gap-4">
          <span className="text-xs font-mono text-white/40 uppercase truncate">ENGINE: {engine}</span>
          {error ? (
            <button onClick={onBack} className="px-5 py-2 rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/5 active:scale-95 transition-all text-xs font-mono flex items-center gap-2 shrink-0">
              <RotateCcw className="w-3.5 h-3.5" /> Back to setup
            </button>
          ) : (
            <button onClick={onCancel} className="px-5 py-2 rounded-full border border-white/20 text-white/70 hover:text-white hover:border-white/40 hover:bg-white/5 active:scale-95 transition-all text-xs font-mono flex items-center gap-2 shrink-0">
              <X className="w-3.5 h-3.5" /> Cancel render
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
