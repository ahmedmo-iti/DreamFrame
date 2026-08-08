import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  ChevronRight,
  Film,
  Gauge,
  Image as ImageIcon,
  Layers3,
  MonitorCog,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import {
  AssetRecord,
  ProjectItem,
  MultiShotBeat,
  MultiShotRenderMode,
  VideoAspectRatio,
  VideoFrameRate,
  VideoQualityMode,
  Workflow3DParams,
  WorkflowCreationType,
  WorkflowMeshParams,
  WorkflowShotParams,
  WorkflowStoryboardParams,
} from '../types';
import img3dModel from '../assets/images/regenerated_image_1785378547653.png';
import { formatVram, loadAndInspectRenderWorkers, RenderWorker } from '../lib/renderWorkers';
import { ShotEditor } from './ShotEditor';

interface WorkflowPanelProps {
  workflow: WorkflowCreationType;
  prefillAsset?: AssetRecord | null;
  prefillProject?: ProjectItem | null;
  onBack: () => void;
  onStartGeneration: (params: {
    sourceImage: string;
    sourceFilename?: string;
    params3d?: Workflow3DParams;
    paramsMesh?: WorkflowMeshParams;
    paramsShot?: WorkflowShotParams;
    paramsStoryboard?: WorkflowStoryboardParams;
  }) => void;
}

const ASPECT_OPTIONS: VideoAspectRatio[] = ['16:9', '2.39:1 Anamorphic', '9:16'];

const PANEL_CONFIG: Record<WorkflowCreationType, { eyebrow: string; title: string; subtitle: string; inputLabel: string; action: string }> = {
  shot: {
    eyebrow: 'WAN 2.2 SCENE WORKSPACE',
    title: 'Cinematic Shot Editor',
    subtitle: 'Plan, edit, reorder, and render up to twelve cinematic scenes. Every scene uses the connected WAN 2.2 image-to-video workflow, with optional references, per-scene direction, and multi-PC assignment.',
    inputLabel: 'OPENING SCENE FRAME',
    action: 'Open Render Queue',
  },
  '3d': {
    eyebrow: '360° SCENE RECONSTRUCTION',
    title: '3D Gaussian Splatting',
    subtitle: 'Turn a 2:1 equirectangular panorama into an immersive Gaussian scene and downloadable PLY output.',
    inputLabel: '360° EQUIRECTANGULAR PANORAMA',
    action: 'Generate Gaussian Scene',
  },
  model: {
    eyebrow: 'TRELLIS.2 ASSET CREATION',
    title: '3D Model Generation',
    subtitle: 'Create textured and untextured GLB assets from a single clean object or concept reference.',
    inputLabel: 'OBJECT OR CONCEPT REFERENCE',
    action: 'Generate 3D Model',
  },
  storyboard: {
    eyebrow: 'FOUR-BEAT STORYBOARD STUDIO',
    title: 'Cinematic Storyboard',
    subtitle: 'Direct four clear story beats, match a visual reference, and render an editorial-ready animatic.',
    inputLabel: 'STORYBOARD LOOK REFERENCE',
    action: 'Render Storyboard Animatic',
  },
  mesh: {
    eyebrow: 'LEGACY WORKFLOW',
    title: 'Surface Mesh Removed',
    subtitle: 'Surface Mesh has been consolidated into 3D Model Generation so artists have one reliable 3D workflow.',
    inputLabel: 'WORKFLOW REMOVED',
    action: 'Unavailable',
  },
  hdri: {
    eyebrow: 'IN DEVELOPMENT',
    title: 'HDRI Environment Skybox',
    subtitle: 'This workflow remains disabled until a production HDRI graph and validated output pipeline are connected.',
    inputLabel: 'WORKFLOW UNAVAILABLE',
    action: 'Coming Soon',
  },
};

function makeShot(index: number): MultiShotBeat {
  const defaults: Array<Pick<MultiShotBeat, 'title' | 'cameraMotion' | 'focalLength'>> = [
    { title: 'Opening Shot', cameraMotion: 'Dolly In', focalLength: '35mm' },
    { title: 'Coverage Shot', cameraMotion: 'Cinematic Pan', focalLength: '50mm' },
    { title: 'Emotional Beat', cameraMotion: 'Locked Off', focalLength: '85mm' },
    { title: 'Closing Shot', cameraMotion: 'Crane Up', focalLength: '24mm' },
  ];
  const item = defaults[index] || defaults[defaults.length - 1];
  return {
    id: crypto.randomUUID(),
    title: item.title,
    prompt: '',
    negativePrompt: '',
    duration: 5,
    cameraMotion: item.cameraMotion,
    focalLength: item.focalLength,
    referenceImage: '',
    referenceFilename: '',
  };
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  format,
  ariaLabel,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  format?: (value: T) => string;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap rounded-xl border border-white/10 bg-black/40 p-1" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={option === value}
          className={`rounded-lg px-3 py-2 text-[11px] font-mono transition-all ${option === value ? 'bg-white text-black font-bold shadow-lg' : 'text-white/55 hover:bg-white/5 hover:text-white'}`}
        >
          {format ? format(option) : String(option)}
        </button>
      ))}
    </div>
  );
}

export const WorkflowPanel: React.FC<WorkflowPanelProps> = ({ workflow, prefillAsset, prefillProject, onBack, onStartGeneration }) => {
  const config = PANEL_CONFIG[workflow];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedFilename, setSelectedFilename] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [modelDetail, setModelDetail] = useState<'Standard' | 'Ultra High'>('Ultra High');
  const [shots, setShots] = useState<MultiShotBeat[]>([makeShot(0), makeShot(1)]);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [fps, setFps] = useState<VideoFrameRate>(24);
  const [qualityMode, setQualityMode] = useState<VideoQualityMode>('Quality');
  const [continuityMode, setContinuityMode] = useState<'Strict' | 'Natural'>('Strict');
  const [renderMode, setRenderMode] = useState<MultiShotRenderMode>('Single PC');
  const [renderWorkers, setRenderWorkers] = useState<RenderWorker[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workersError, setWorkersError] = useState('');
  const [workersConfigFile, setWorkersConfigFile] = useState('dreamframe-workers.json');
  const [storyboardPrompts, setStoryboardPrompts] = useState<[string, string, string, string]>(['', '', '', '']);
  const [storyboardStyleInfluence, setStoryboardStyleInfluence] = useState(0.65);
  const [storyboardHold, setStoryboardHold] = useState<1 | 2 | 3>(2);
  const [storyboardFps, setStoryboardFps] = useState<12 | 24>(12);

  useEffect(() => {
    if (workflow === 'shot' && prefillProject?.paramsShot) {
      setSelectedImage(prefillProject.sourceImage || prefillProject.thumbnailUrl || '');
      setSelectedFilename(prefillProject.sourceFilename || '');
      setShots(prefillProject.paramsShot.shots.map((shot, index) => ({
        ...shot,
        id: shot.id || crypto.randomUUID(),
        title: shot.title || `Scene ${index + 1}`,
        negativePrompt: shot.negativePrompt || '',
      })));
      setAspectRatio(prefillProject.paramsShot.aspectRatio);
      setFps(prefillProject.paramsShot.fps);
      setQualityMode(prefillProject.paramsShot.qualityMode);
      setContinuityMode(prefillProject.paramsShot.continuityMode);
      setRenderMode(prefillProject.paramsShot.renderMode || 'Single PC');
      return;
    }

    if (prefillAsset && (prefillAsset.workflowTarget === workflow || prefillAsset.category === workflow)) {
      setSelectedImage(prefillAsset.sourceImage || prefillAsset.thumbnailUrl || '');
      setSelectedFilename(prefillAsset.sourceFilename || '');
      return;
    }

    if (workflow === 'model') {
      setSelectedImage(img3dModel);
      setSelectedFilename('');
    } else {
      setSelectedImage('');
      setSelectedFilename('');
    }
  }, [workflow, prefillAsset, prefillProject]);

  const refreshRenderWorkers = async () => {
    if (workflow !== 'shot') return;
    const controller = new AbortController();
    setWorkersLoading(true);
    setWorkersError('');
    try {
      const response = await loadAndInspectRenderWorkers(controller.signal);
      setRenderWorkers(response.workers);
      setWorkersConfigFile(response.configFile || 'dreamframe-workers.json');
      const online = response.workers.filter((worker) => worker.status === 'online');
      setShots((previous) => previous.map((shot, index) => ({
        ...shot,
        workerId: shot.workerId && online.some((worker) => worker.id === shot.workerId)
          ? shot.workerId
          : online[index % Math.max(1, online.length)]?.id,
      })));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setWorkersError(error instanceof Error ? error.message : 'Could not inspect render PCs.');
      }
    } finally {
      setWorkersLoading(false);
    }
  };

  useEffect(() => {
    if (workflow !== 'shot') return;
    void refreshRenderWorkers();
  }, [workflow]);

  const loadFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(String(reader.result || ''));
      setSelectedFilename(file.name);
    };
    reader.readAsDataURL(file);
  };

  const storyboardDuration = storyboardHold * 4;
  const onlineWorkers = renderWorkers.filter((worker) => worker.status === 'online');
  const distributedReady = renderMode === 'Single PC' || onlineWorkers.length >= 2;
  const disabled =
    workflow === 'mesh' ||
    workflow === 'hdri' ||
    !selectedImage ||
    (workflow === 'shot' && !distributedReady) ||
    (workflow === 'shot' && (shots.length < 1 || shots.length > 12 || shots.some((shot) => !shot.prompt.trim()))) ||
    (workflow === 'storyboard' && storyboardPrompts.some((prompt) => !prompt.trim()));

  const handleGenerate = () => {
    if (workflow === 'shot') {
      onStartGeneration({
        sourceImage: selectedImage,
        sourceFilename: selectedFilename || undefined,
        paramsShot: {
          shots,
          aspectRatio,
          fps,
          qualityMode,
          continuityMode,
          renderMode,
          seed: Math.floor(Math.random() * 2_147_483_000),
        },
      });
      return;
    }

    if (workflow === 'storyboard') {
      onStartGeneration({
        sourceImage: selectedImage,
        sourceFilename: selectedFilename || undefined,
        paramsStoryboard: {
          shotPrompts: storyboardPrompts,
          styleInfluence: storyboardStyleInfluence,
          holdSeconds: storyboardHold,
          fps: storyboardFps,
          seed: Math.floor(Math.random() * 2_147_483_000),
        },
      });
      return;
    }

    if (workflow === 'model') {
      onStartGeneration({
        sourceImage: selectedImage,
        sourceFilename: selectedFilename || undefined,
        paramsMesh: {
          output: 'Mesh',
          density: modelDetail,
          cleanTopology: true,
          poissonDepth: 10,
          exportFormat: 'GLTF',
        },
      });
      return;
    }

    if (workflow === '3d') {
      onStartGeneration({
        sourceImage: selectedImage,
        sourceFilename: selectedFilename || undefined,
        params3d: {
          quality: 'Production',
          gaussianSplatCount: '2M',
          sphericalHarmonics: true,
          depthThreshold: 0.85,
          cameraIntrinsics: 'Equirectangular',
        },
      });
    }
  };

  const selectedExtension = selectedFilename.split('.').pop()?.toLowerCase();
  const canPreview = selectedImage && selectedExtension !== 'hdr' && selectedExtension !== 'exr';
  const uploadAccept = workflow === '3d' ? '.hdr,.exr,image/png,image/jpeg,image/webp' : 'image/*';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35 }}
      className={`mx-auto w-full px-4 py-6 sm:px-6 ${workflow === 'shot' || workflow === 'storyboard' ? 'max-w-6xl' : 'max-w-4xl'}`}
    >
      <section className="dreamframe-card relative flex flex-col gap-8 overflow-hidden rounded-3xl border border-white/15 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl sm:p-10" aria-labelledby="workflow-title">
        <div className="cool-white-bloom -left-20 -top-20 h-96 w-96" aria-hidden="true" />

        <header className="relative flex items-start justify-between gap-5 border-b border-white/10 pb-6">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-white/40">{config.eyebrow}</div>
            <h1 id="workflow-title" className="mt-2 font-grotesk text-3xl font-black text-white sm:text-4xl">{config.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">{config.subtitle}</p>
          </div>
          <button type="button" onClick={onBack} aria-label="Close workflow" className="rounded-full border border-white/10 bg-white/5 p-2.5 text-white/55 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        {(workflow === 'mesh' || workflow === 'hdri') ? (
          <div className="rounded-3xl border border-amber-300/20 bg-amber-500/10 p-8 text-center">
            <Layers3 className="mx-auto h-9 w-9 text-amber-200" />
            <h2 className="mt-4 text-xl font-bold text-white">This workflow is not available</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/55">
              {workflow === 'mesh' ? 'Use 3D Model Generation for the supported TRELLIS.2 geometry pipeline.' : 'HDRI remains hidden from production creation until its graph is validated.'}
            </p>
          </div>
        ) : (
          <>
            <div className="relative flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-white/65">01 · {config.inputLabel}</label>
                <span className="text-[10px] font-mono text-white/35">{workflow === '3d' ? '2:1 HDR · EXR · PNG · JPG' : 'PNG · JPG · WEBP'}</span>
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-label={`Upload ${config.inputLabel.toLowerCase()}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  loadFile(event.dataTransfer.files[0]);
                }}
                className={`group relative flex h-56 w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed p-4 transition-all sm:h-64 ${isDragging ? 'scale-[1.01] border-white bg-white/10' : 'border-white/15 bg-black/55 hover:border-white/35'}`}
              >
                <input ref={fileInputRef} className="hidden" type="file" accept={uploadAccept} onChange={(event) => loadFile(event.target.files?.[0])} />
                {canPreview && (
                  <div className="absolute inset-0" aria-hidden="true">
                    <img src={selectedImage} alt="" className="h-full w-full scale-105 object-cover blur-[7px] brightness-[0.35] saturate-75 transition-all group-hover:brightness-[0.3]" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/65" />
                  </div>
                )}
                <div className="relative z-10 flex flex-col items-center gap-3 text-center">
                  <div className="rounded-2xl border border-white/15 bg-black/45 p-3 text-white backdrop-blur-md"><Upload className="h-5 w-5" /></div>
                  <div className="text-xs font-mono text-white/90">{selectedImage ? 'Source ready — click or drag to replace' : 'Click or drag to add source'}</div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">Local file · processed by your ComfyUI</div>
                </div>
                {selectedImage && <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-black/55 px-3 py-1 text-[10px] font-mono uppercase text-emerald-200"><Check className="h-3 w-3" /> Ready</div>}
              </div>
            </div>

            {workflow === 'shot' && (
              <div className="relative flex flex-col gap-5">
                <div className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(255,255,255,0.025))] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-white/65"><MonitorCog className="h-4 w-4" /> Render devices</div>
                      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/45">Use one ComfyUI PC, or distribute ready shots across several PCs on the same network. Shots with their own reference image can start together; continuity-dependent shots wait for the previous result.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Segmented value={renderMode} options={['Single PC', 'Multiple PCs'] as const} onChange={setRenderMode} ariaLabel="Render device mode" />
                      <button type="button" onClick={() => void refreshRenderWorkers()} disabled={workersLoading} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.14em] text-white/65 hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
                        <RefreshCw className={`h-3.5 w-3.5 ${workersLoading ? 'animate-spin' : ''}`} /> Refresh PCs
                      </button>
                    </div>
                  </div>

                  {renderMode === 'Multiple PCs' && (
                    <div className="mt-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {renderWorkers.map((worker) => (
                          <div key={worker.id} className={`rounded-xl border p-3 ${worker.status === 'online' ? 'border-emerald-400/18 bg-emerald-500/[0.055]' : 'border-rose-400/18 bg-rose-500/[0.055]'}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-white">{worker.name}</div>
                                <div className="mt-1 truncate text-[10px] font-mono uppercase tracking-[0.13em] text-white/38">{worker.deviceName || worker.id}</div>
                              </div>
                              <span className={`rounded-full border px-2 py-1 text-[9px] font-mono uppercase tracking-[0.12em] ${worker.status === 'online' ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200' : 'border-rose-300/20 bg-rose-400/10 text-rose-200'}`}>{worker.status === 'online' ? 'Online' : 'Offline'}</span>
                            </div>
                            <div className="mt-2 text-[10px] text-white/42">{worker.status === 'online' ? `${formatVram(worker.vramFreeBytes)} free` : worker.error || 'Could not reach ComfyUI'}</div>
                          </div>
                        ))}
                      </div>
                      {workersError && <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{workersError}</div>}
                      {onlineWorkers.length < 2 && !workersLoading && (
                        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-100/80">Enable at least two PCs in <strong>{workersConfigFile}</strong>, start ComfyUI with LAN access on each machine, then refresh.</div>
                      )}
                    </div>
                  )}
                </div>

                <ShotEditor
                  shots={shots}
                  setShots={setShots}
                  openingImage={selectedImage}
                  renderMode={renderMode}
                  onlineWorkers={onlineWorkers}
                />

                <div className="grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-transparent p-5 md:grid-cols-2">
                  <ArtistOption title="Output framing" description="Choose the final screen shape for every shot.">
                    <Segmented value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} ariaLabel="Output framing" format={(value) => value === '2.39:1 Anamorphic' ? 'CINEMA' : value === '9:16' ? 'VERTICAL' : 'WIDESCREEN'} />
                  </ArtistOption>
                  <ArtistOption title="Motion feel" description="24 FPS is more cinematic; 16 FPS renders faster.">
                    <Segmented value={fps} options={[16, 24] as const} onChange={setFps} ariaLabel="Frame rate" format={(value) => `${value} FPS`} />
                  </ArtistOption>
                  <ArtistOption title="Continuity behavior" description="Strict protects identity and layout; Natural allows more evolution.">
                    <Segmented value={continuityMode} options={['Strict', 'Natural'] as const} onChange={setContinuityMode} ariaLabel="Continuity behavior" />
                  </ArtistOption>
                  <ArtistOption title="Render priority" description="Quality uses the full workflow; Fast uses the connected fast path.">
                    <Segmented value={qualityMode} options={['Quality', 'Fast'] as const} onChange={setQualityMode} ariaLabel="Render priority" />
                  </ArtistOption>
                </div>
              </div>
            )}

            {workflow === 'model' && (
              <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2">
                <ArtistOption title="Model detail" description="Balanced targets a lighter 250K-face asset. Hero Detail targets up to 500K faces and a larger texture.">
                  <Segmented value={modelDetail} options={['Standard', 'Ultra High'] as const} onChange={setModelDetail} ariaLabel="Model detail" format={(value) => value === 'Standard' ? 'BALANCED' : 'HERO DETAIL'} />
                </ArtistOption>
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] p-5">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-emerald-200/70"><Layers3 className="h-4 w-4" /> Deliverables</div>
                  <div className="mt-3 text-lg font-bold text-white">Textured + clean GLB</div>
                  <p className="mt-1 text-xs leading-relaxed text-white/45">Both textured and untextured model files are exported by the connected TRELLIS.2 graph.</p>
                </div>
              </div>
            )}

            {workflow === 'storyboard' && (
              <div className="relative flex flex-col gap-5">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {[
                    ['Frame 01 · Establishing Shot', 'Set the location, scale, geography, and opening composition.'],
                    ['Frame 02 · Story Beat', 'Describe the meaningful action, discovery, or reaction.'],
                    ['Frame 03 · Turning Point', 'Build the strongest dramatic or emotional image.'],
                    ['Frame 04 · Closing Image', 'Land the sequence with a memorable final composition.'],
                  ].map(([title, hint], index) => (
                    <label key={title} className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <span className="text-xs font-bold text-white">{title}</span>
                      <span className="mt-1 block text-[10px] leading-relaxed text-white/35">{hint}</span>
                      <textarea
                        value={storyboardPrompts[index]}
                        onChange={(event) => {
                          const next = [...storyboardPrompts] as [string, string, string, string];
                          next[index] = event.target.value;
                          setStoryboardPrompts(next);
                        }}
                        rows={5}
                        className="mt-3 w-full resize-y rounded-xl border border-white/10 bg-black/55 p-3 text-xs leading-relaxed text-white outline-none placeholder:text-white/25 focus:border-white/30"
                        placeholder="Describe subject, action, framing, mood, and production intent..."
                      />
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/10 to-transparent p-5 md:grid-cols-3">
                  <ArtistOption title="Reference influence" description="How closely every frame follows the uploaded visual language.">
                    <div className="mt-3 flex items-center gap-3">
                      <input type="range" min="0" max="1" step="0.05" value={storyboardStyleInfluence} onChange={(event) => setStoryboardStyleInfluence(Number(event.target.value))} className="w-full accent-white" aria-label="Reference influence" />
                      <span className="w-12 rounded-lg bg-black/50 px-2 py-1.5 text-center text-xs font-bold text-white">{Math.round(storyboardStyleInfluence * 100)}%</span>
                    </div>
                  </ArtistOption>
                  <ArtistOption title="Editorial hold" description="How long each storyboard frame stays on screen.">
                    <Segmented value={storyboardHold} options={[1, 2, 3] as const} onChange={setStoryboardHold} ariaLabel="Editorial hold" format={(value) => `${value} SEC`} />
                  </ArtistOption>
                  <ArtistOption title="Playback feel" description="12 FPS is classic animatic timing; 24 FPS gives smoother playback.">
                    <Segmented value={storyboardFps} options={[12, 24] as const} onChange={setStoryboardFps} ariaLabel="Storyboard playback frame rate" format={(value) => `${value} FPS`} />
                  </ArtistOption>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-[11px] font-mono text-white/45">Final animatic: 4 frames · {storyboardDuration} sec · {storyboardFps} FPS</div>
              </div>
            )}

            {workflow === '3d' && (
              <div className="relative grid grid-cols-1 gap-4 md:grid-cols-3">
                <InfoTile icon={ImageIcon} label="Best source" value="Clean 2:1 panorama" />
                <InfoTile icon={Layers3} label="Deliverable" value="Gaussian PLY" />
                <InfoTile icon={Gauge} label="Viewer" value="Interactive splat preview" />
              </div>
            )}

            <div className="relative flex justify-end pt-1">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={disabled}
                className={`flex w-full items-center justify-center gap-2 rounded-full px-8 py-4 text-sm font-bold tracking-wide transition-all sm:w-auto ${disabled ? 'cursor-not-allowed bg-white/10 text-white/30' : 'bg-white text-black shadow-xl shadow-black/50 hover:bg-neutral-200 active:scale-[0.98]'}`}
              >
                {(workflow === 'shot' && renderMode === 'Multiple PCs' ? 'OPEN MULTI-PC RENDER QUEUE' : config.action).toUpperCase()} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </section>
    </motion.div>
  );
};

function ArtistOption({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 p-4">
      <div className="text-xs font-bold text-white">{title}</div>
      <p className="mt-1 min-h-8 text-[10px] leading-relaxed text-white/35">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function InfoTile({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <Icon className="h-5 w-5 text-white/60" />
      <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className="mt-1 text-sm font-bold text-white">{value}</div>
    </div>
  );
}
