import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  Clock3,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Link2,
  MonitorCog,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CameraMotion,
  CinemaLens,
  MultiShotBeat,
  MultiShotRenderMode,
  ShotDuration,
} from '../types';
import { RenderWorker } from '../lib/renderWorkers';

const CAMERA_OPTIONS: CameraMotion[] = ['Dolly In', 'Cinematic Pan', 'Orbit', 'Crane Up', 'FPV Chase', 'Locked Off'];
const LENS_OPTIONS: CinemaLens[] = ['24mm', '35mm', '50mm', '85mm'];
const DURATION_OPTIONS: ShotDuration[] = [3, 5];
const MAX_SHOTS = 12;

interface ShotEditorProps {
  shots: MultiShotBeat[];
  setShots: React.Dispatch<React.SetStateAction<MultiShotBeat[]>>;
  openingImage: string;
  renderMode: MultiShotRenderMode;
  onlineWorkers: RenderWorker[];
}

function createEditorShot(index: number, workerId?: string): MultiShotBeat {
  const defaults: Array<Pick<MultiShotBeat, 'title' | 'cameraMotion' | 'focalLength'>> = [
    { title: 'Opening Shot', cameraMotion: 'Dolly In', focalLength: '35mm' },
    { title: 'Coverage Shot', cameraMotion: 'Cinematic Pan', focalLength: '50mm' },
    { title: 'Emotional Beat', cameraMotion: 'Locked Off', focalLength: '85mm' },
    { title: 'Closing Shot', cameraMotion: 'Crane Up', focalLength: '24mm' },
  ];
  const preset = defaults[index] || {
    title: `Scene ${index + 1}`,
    cameraMotion: 'Dolly In' as CameraMotion,
    focalLength: '35mm' as CinemaLens,
  };
  return {
    id: crypto.randomUUID(),
    title: preset.title,
    prompt: '',
    negativePrompt: '',
    duration: 5,
    cameraMotion: preset.cameraMotion,
    focalLength: preset.focalLength,
    referenceImage: '',
    referenceFilename: '',
    workerId,
  };
}

function sanitizeImportedShot(raw: Partial<MultiShotBeat>, index: number, workerId?: string): MultiShotBeat {
  const fallback = createEditorShot(index, workerId);
  return {
    ...fallback,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.slice(0, 120) : fallback.title,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    negativePrompt: typeof raw.negativePrompt === 'string' ? raw.negativePrompt : '',
    duration: DURATION_OPTIONS.includes(raw.duration as ShotDuration) ? raw.duration as ShotDuration : fallback.duration,
    cameraMotion: CAMERA_OPTIONS.includes(raw.cameraMotion as CameraMotion) ? raw.cameraMotion as CameraMotion : fallback.cameraMotion,
    focalLength: LENS_OPTIONS.includes(raw.focalLength as CinemaLens) ? raw.focalLength as CinemaLens : fallback.focalLength,
    workerId: typeof raw.workerId === 'string' ? raw.workerId : workerId,
  };
}

export const ShotEditor: React.FC<ShotEditorProps> = ({ shots, setShots, openingImage, renderMode, onlineWorkers }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const referenceInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const planInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedIndex((previous) => Math.max(0, Math.min(previous, shots.length - 1)));
  }, [shots.length]);

  const selectedShot = shots[selectedIndex];
  const totalSeconds = useMemo(() => shots.reduce((total, shot) => total + shot.duration, 0), [shots]);
  const customReferences = useMemo(() => shots.filter((shot) => Boolean(shot.referenceImage)).length, [shots]);

  const updateSelected = <K extends keyof MultiShotBeat>(key: K, value: MultiShotBeat[K]) => {
    setShots((previous) => previous.map((shot, index) => index === selectedIndex ? { ...shot, [key]: value } : shot));
  };

  const loadReference = (file?: File) => {
    if (!file || !selectedShot) return;
    const shotId = selectedShot.id;
    const reader = new FileReader();
    reader.onload = () => {
      setShots((previous) => previous.map((shot) => shot.id === shotId ? {
        ...shot,
        referenceImage: String(reader.result || ''),
        referenceFilename: file.name,
      } : shot));
    };
    reader.readAsDataURL(file);
  };

  const clearReference = () => {
    if (!selectedShot) return;
    const shotId = selectedShot.id;
    setShots((previous) => previous.map((shot) => shot.id === shotId ? {
      ...shot,
      referenceImage: '',
      referenceFilename: '',
    } : shot));
    const input = referenceInputs.current[shotId];
    if (input) input.value = '';
  };

  const moveSelected = (direction: -1 | 1) => {
    const nextIndex = selectedIndex + direction;
    if (nextIndex < 0 || nextIndex >= shots.length) return;
    setShots((previous) => {
      const next = [...previous];
      [next[selectedIndex], next[nextIndex]] = [next[nextIndex], next[selectedIndex]];
      return next;
    });
    setSelectedIndex(nextIndex);
  };

  const duplicateSelected = () => {
    if (!selectedShot || shots.length >= MAX_SHOTS) return;
    const copy: MultiShotBeat = {
      ...selectedShot,
      id: crypto.randomUUID(),
      title: `${selectedShot.title || `Scene ${selectedIndex + 1}`} Copy`,
    };
    setShots((previous) => [...previous.slice(0, selectedIndex + 1), copy, ...previous.slice(selectedIndex + 1)]);
    setSelectedIndex(selectedIndex + 1);
  };

  const removeSelected = () => {
    if (!selectedShot || shots.length <= 1) return;
    const nextIndex = Math.max(0, selectedIndex - (selectedIndex === shots.length - 1 ? 1 : 0));
    setShots((previous) => previous.filter((shot) => shot.id !== selectedShot.id));
    setSelectedIndex(nextIndex);
  };

  const addShot = () => {
    if (shots.length >= MAX_SHOTS) return;
    const workerId = onlineWorkers[shots.length % Math.max(1, onlineWorkers.length)]?.id;
    setShots((previous) => [...previous, createEditorShot(previous.length, workerId)]);
    setSelectedIndex(shots.length);
  };

  const exportPlan = () => {
    const plan = {
      format: 'dreamframe-shot-plan',
      version: 1,
      exportedAt: new Date().toISOString(),
      shots: shots.map(({ referenceImage: _referenceImage, ...shot }) => shot),
    };
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dreamframe-shot-plan-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPlan = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}')) as { shots?: Partial<MultiShotBeat>[] } | Partial<MultiShotBeat>[];
        const rawShots = Array.isArray(parsed) ? parsed : parsed.shots;
        if (!Array.isArray(rawShots) || rawShots.length === 0) throw new Error('No scenes found in this shot plan.');
        const imported = rawShots.slice(0, MAX_SHOTS).map((shot, index) => sanitizeImportedShot(
          shot,
          index,
          onlineWorkers[index % Math.max(1, onlineWorkers.length)]?.id,
        ));
        setShots(imported);
        setSelectedIndex(0);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Could not load this shot plan.');
      } finally {
        if (planInputRef.current) planInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  if (!selectedShot) return null;

  const visualSource = selectedShot.referenceImage || openingImage;
  const inheritsContinuity = selectedIndex > 0 && !selectedShot.referenceImage;

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,12,17,0.96),rgba(5,5,8,0.98))] shadow-[0_24px_70px_rgba(0,0,0,0.3)]">
      <header className="flex flex-col gap-4 border-b border-white/10 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-violet-200/55">Scene planning workspace</div>
          <h2 className="mt-1 font-grotesk text-2xl font-black tracking-[-0.04em] text-white">Shot Editor</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/45">Select a scene from the timeline, edit its direction, reference, lens, camera motion, duration, and render PC, then render with the connected WAN 2.2 workflow.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={planInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => importPlan(event.target.files?.[0])} />
          <button type="button" onClick={() => planInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] text-white/65 hover:bg-white/[0.08] hover:text-white">
            <Upload className="h-3.5 w-3.5" /> Import plan
          </button>
          <button type="button" onClick={exportPlan} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] text-white/65 hover:bg-white/[0.08] hover:text-white">
            <Download className="h-3.5 w-3.5" /> Export plan
          </button>
        </div>
      </header>

      <div className="border-b border-white/10 bg-black/25 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/38">Scene timeline</div>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-white/42">
            <span>{shots.length}/{MAX_SHOTS} scenes</span>
            <span>·</span>
            <span>{totalSeconds} sec</span>
            <span>·</span>
            <span>{customReferences} custom refs</span>
          </div>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {shots.map((shot, index) => {
            const active = index === selectedIndex;
            const thumbnail = shot.referenceImage || openingImage;
            return (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={`group relative min-w-[172px] max-w-[172px] overflow-hidden rounded-2xl border text-left transition-all ${active ? 'border-violet-300/45 bg-violet-500/10 shadow-[0_0_0_1px_rgba(196,181,253,0.12),0_14px_35px_rgba(76,29,149,0.3)]' : 'border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.05]'}`}
              >
                <div className="relative h-24 overflow-hidden bg-black">
                  {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover brightness-[0.72] transition-transform duration-500 group-hover:scale-[1.04]" /> : <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6 text-white/18" /></div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                  <span className="absolute left-2 top-2 rounded-lg border border-white/10 bg-black/55 px-2 py-1 text-[9px] font-mono text-white/75">{String(index + 1).padStart(2, '0')}</span>
                  <span className={`absolute bottom-2 right-2 rounded-full border px-2 py-1 text-[8px] font-mono uppercase tracking-[0.1em] ${shot.referenceImage ? 'border-emerald-300/20 bg-emerald-500/15 text-emerald-100' : 'border-white/10 bg-black/55 text-white/50'}`}>{shot.referenceImage ? 'Custom ref' : index === 0 ? 'Opening' : 'Continuity'}</span>
                </div>
                <div className="p-3">
                  <div className="truncate text-xs font-bold text-white">{shot.title || `Scene ${index + 1}`}</div>
                  <div className="mt-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.1em] text-white/35"><span>{shot.duration}s</span><span>{shot.focalLength}</span></div>
                </div>
              </button>
            );
          })}
          {shots.length < MAX_SHOTS && (
            <button type="button" onClick={addShot} className="flex min-h-[145px] min-w-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/14 bg-white/[0.02] text-white/45 hover:border-white/30 hover:bg-white/[0.05] hover:text-white">
              <Plus className="h-5 w-5" />
              <span className="text-[10px] font-mono uppercase tracking-[0.14em]">Add scene</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="border-b border-white/10 p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/38">Scene {selectedIndex + 1} visual source</div>
              <div className="mt-1 text-sm font-bold text-white">{selectedShot.referenceImage ? 'Custom reference image' : selectedIndex === 0 ? 'Opening continuity frame' : 'Previous scene final frame'}</div>
            </div>
            {selectedShot.referenceImage && <button type="button" onClick={clearReference} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase text-white/55 hover:bg-rose-500/10 hover:text-rose-200">Clear</button>}
          </div>

          <button type="button" onClick={() => referenceInputs.current[selectedShot.id]?.click()} className="group relative mt-4 flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/55 text-left hover:border-white/30">
            <input ref={(element) => { referenceInputs.current[selectedShot.id] = element; }} type="file" accept="image/*" className="hidden" onChange={(event) => loadReference(event.target.files?.[0])} />
            {visualSource ? (
              <>
                <img src={visualSource} alt="" className={`absolute inset-0 h-full w-full object-cover transition-all duration-500 group-hover:scale-[1.025] ${inheritsContinuity ? 'brightness-[0.42] blur-[1px]' : 'brightness-[0.75]'}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/20" />
              </>
            ) : null}
            <div className="relative z-10 flex h-full w-full flex-col items-center justify-center p-5 text-center">
              {inheritsContinuity ? <Link2 className="h-7 w-7 text-violet-200/75" /> : <ImageIcon className="h-7 w-7 text-white/70" />}
              <div className="mt-3 text-sm font-bold text-white">{inheritsContinuity ? 'Inherited at render time' : selectedShot.referenceImage ? 'Replace scene reference' : 'Add a scene reference'}</div>
              <div className="mt-1 max-w-sm text-xs leading-relaxed text-white/48">{inheritsContinuity ? `Scene ${selectedIndex + 1} will begin from the final frame of scene ${selectedIndex}. Upload an image here to make it independent.` : 'Click to choose a different visual starting point for this scene.'}</div>
            </div>
          </button>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => moveSelected(-1)} disabled={selectedIndex === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-25"><ArrowLeft className="h-4 w-4" /> Earlier</button>
            <button type="button" onClick={() => moveSelected(1)} disabled={selectedIndex === shots.length - 1} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-25">Later <ArrowRight className="h-4 w-4" /></button>
            <button type="button" onClick={duplicateSelected} disabled={shots.length >= MAX_SHOTS} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-25"><Copy className="h-4 w-4" /> Duplicate</button>
            <button type="button" onClick={removeSelected} disabled={shots.length <= 1} className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/10 bg-rose-500/[0.035] px-3 py-2.5 text-xs text-rose-100/55 hover:bg-rose-500/10 hover:text-rose-100 disabled:opacity-25"><Trash2 className="h-4 w-4" /> Delete</button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/38">Scene title</span>
              <input value={selectedShot.title} onChange={(event) => updateSelected('title', event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/45 px-4 py-3 text-sm font-bold text-white outline-none focus:border-white/30" placeholder={`Scene ${selectedIndex + 1}`} />
            </label>
            <div className="rounded-xl border border-violet-300/12 bg-violet-500/[0.055] px-4 py-3 text-right">
              <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/35">Scene number</div>
              <div className="mt-0.5 text-lg font-black text-white">{String(selectedIndex + 1).padStart(2, '0')}</div>
            </div>
          </div>

          <label className="mt-5 block">
            <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/38"><Film className="h-3.5 w-3.5" /> Scene direction</span>
            <textarea value={selectedShot.prompt} onChange={(event) => updateSelected('prompt', event.target.value)} rows={7} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-4 text-sm leading-7 text-white outline-none placeholder:text-white/22 focus:border-white/30" placeholder="Describe the scene action, emotion, staging, subject movement, environment movement, lighting changes, and the exact moment this shot should capture..." />
          </label>

          <label className="mt-4 block">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/38">Avoid in this scene</span>
            <textarea value={selectedShot.negativePrompt || ''} onChange={(event) => updateSelected('negativePrompt', event.target.value)} rows={2} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-3 text-xs leading-6 text-white outline-none placeholder:text-white/22 focus:border-white/30" placeholder="Optional: objects, artifacts, motions, or style changes to avoid..." />
          </label>

          <div className={`mt-5 grid gap-3 sm:grid-cols-2 ${renderMode === 'Multiple PCs' ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
            <label className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/38"><Clock3 className="h-3.5 w-3.5" /> Duration</span>
              <select value={selectedShot.duration} onChange={(event) => updateSelected('duration', Number(event.target.value) as ShotDuration)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/75 px-3 py-2.5 text-xs text-white outline-none">
                {DURATION_OPTIONS.map((option) => <option key={option} value={option}>{option} seconds</option>)}
              </select>
            </label>
            <label className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/38"><Film className="h-3.5 w-3.5" /> Camera</span>
              <select value={selectedShot.cameraMotion} onChange={(event) => updateSelected('cameraMotion', event.target.value as CameraMotion)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/75 px-3 py-2.5 text-xs text-white outline-none">
                {CAMERA_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
              <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/38"><Aperture className="h-3.5 w-3.5" /> Lens</span>
              <select value={selectedShot.focalLength} onChange={(event) => updateSelected('focalLength', event.target.value as CinemaLens)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/75 px-3 py-2.5 text-xs text-white outline-none">
                {LENS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            {renderMode === 'Multiple PCs' && (
              <label className="rounded-xl border border-cyan-300/12 bg-cyan-500/[0.045] p-3">
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-white/38"><MonitorCog className="h-3.5 w-3.5" /> Render PC</span>
                <select value={selectedShot.workerId || ''} onChange={(event) => updateSelected('workerId', event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/75 px-3 py-2.5 text-xs text-white outline-none">
                  {onlineWorkers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
