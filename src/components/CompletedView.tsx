import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Pause,
  Play,
  Plus,
  Sparkles,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { ProjectItem, WorkflowCreationType } from '../types';
import { ComfyOutputFile, GenerationResult } from '../lib/comfyApi';
import { GaussianSplatViewport } from './viewports/GaussianSplatViewport';
import { MeshViewport } from './viewports/MeshViewport';
import { WorkflowView } from './WorkflowView';

interface CompletedViewProps {
  workflow: WorkflowCreationType;
  sourceImage: string;
  projectItem?: ProjectItem;
  generationResult?: GenerationResult | null;
  onCreateAnother: () => void;
  onEditScenes?: () => void;
  onSaveToProjects: (item: ProjectItem) => void;
  onGoAssets?: () => void;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);
const MODEL_EXTENSIONS = new Set(['glb', 'gltf']);

function dedupeFiles(files: ComfyOutputFile[]) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.type}:${file.subfolder}:${file.filename}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatRenderDuration(milliseconds?: number) {
  if (!milliseconds) return 'Not recorded';
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${remainder}s`;
}

export const CompletedView: React.FC<CompletedViewProps> = ({
  workflow,
  sourceImage,
  projectItem,
  generationResult,
  onCreateAnother,
  onEditScenes,
  onGoAssets,
}) => {
  const [showMore, setShowMore] = useState(false);
  const [tab, setTab] = useState<'output' | 'workflow'>('output');
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const [selectedShot, setSelectedShot] = useState(0);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [playSequence, setPlaySequence] = useState(() => !reducedMotion);
  const videoRef = useRef<HTMLVideoElement>(null);

  const resolvedResult = generationResult ?? projectItem?.generationResult ?? null;
  const outputFiles = useMemo(
    () => dedupeFiles(resolvedResult?.outputFiles ?? projectItem?.outputFiles ?? []),
    [projectItem?.outputFiles, resolvedResult?.outputFiles],
  );
  const modelFiles = outputFiles.filter((file) => MODEL_EXTENSIONS.has(file.extension));
  const videoFiles = outputFiles.filter((file) => VIDEO_EXTENSIONS.has(file.extension));
  const plyFiles = outputFiles.filter((file) => file.extension === 'ply');
  const gaussianFile =
    plyFiles.find((file) => /transform|rotat/i.test(file.filename)) ||
    plyFiles.find((file) => /gaussian|merged/i.test(file.filename)) ||
    plyFiles[plyFiles.length - 1];
  const untexturedFile = modelFiles.find((file) => file.filename.toLowerCase().includes('untextured'));
  const texturedFile = modelFiles.find((file) => !file.filename.toLowerCase().includes('untextured'));
  const modelFile = texturedFile || untexturedFile;

  const gaussianUrl = gaussianFile?.url || (projectItem?.previewKind === 'gaussian' ? projectItem.downloadUrl : undefined);
  const gaussianName = gaussianFile?.filename || projectItem?.downloadFilename;
  const modelUrl = modelFile?.url || (projectItem?.previewKind === 'model' ? projectItem.downloadUrl : undefined);
  const modelName = modelFile?.filename || projectItem?.downloadFilename;
  const activeVideo = videoFiles[selectedShot] || (projectItem?.previewKind === 'video' && projectItem.downloadUrl
    ? { url: projectItem.downloadUrl, filename: projectItem.downloadFilename || 'dreamframe-video.mp4', extension: 'mp4', type: 'output' as const, subfolder: '' }
    : undefined);

  const primaryFiles = [gaussianFile, ...modelFiles, ...videoFiles].filter(Boolean) as ComfyOutputFile[];
  const otherFiles = outputFiles.filter((file) => !primaryFiles.includes(file));
  const title = projectItem?.title ||
    (workflow === '3d'
      ? 'Gaussian Splat Environment'
      : workflow === 'model' || workflow === 'mesh'
        ? 'TRELLIS.2 3D Model'
        : workflow === 'storyboard'
          ? 'Cinematic Storyboard Animatic'
          : 'Cinematic Shot Editor Sequence');

  const shotResults = resolvedResult?.shotResults ?? [];
  const renderDurationMs = resolvedResult?.renderDurationMs ?? projectItem?.renderDurationMs;
  const outputDuration = resolvedResult?.totalOutputDurationSec ?? projectItem?.totalOutputDurationSec;
  const outputAvailable = workflow === '3d' ? Boolean(gaussianUrl) : workflow === 'model' || workflow === 'mesh' ? Boolean(modelUrl) : Boolean(activeVideo);

  useEffect(() => {
    if (selectedShot >= Math.max(1, videoFiles.length)) setSelectedShot(0);
  }, [selectedShot, videoFiles.length]);

  useEffect(() => {
    if (!activeVideo || !videoRef.current) return;
    videoRef.current.load();
    if (playSequence) void videoRef.current.play().catch(() => undefined);
  }, [activeVideo?.url, playSequence]);

  useEffect(() => {
    if (!showMore) return;
    const panel = morePanelRef.current;
    panel?.querySelector<HTMLElement>('a,button')?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowMore(false);
      window.setTimeout(() => moreTriggerRef.current?.focus(), 0);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (panel?.contains(event.target as Node) || moreTriggerRef.current?.contains(event.target as Node)) return;
      setShowMore(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [showMore]);

  const markDownloaded = () => {
    setDownloadSuccess(true);
    window.setTimeout(() => setDownloadSuccess(false), 2200);
  };

  const handleVideoEnded = () => {
    if (!playSequence || videoFiles.length <= 1) return;
    setSelectedShot((current) => (current + 1) % videoFiles.length);
  };

  const renderOutput = () => {
    if (!outputAvailable) return <MissingOutput workflow={workflow} />;
    if (workflow === '3d') return <GaussianSplatViewport plyUrl={gaussianUrl} filename={gaussianName} interactive />;
    if (workflow === 'model' || workflow === 'mesh') return <MeshViewport interactive outputMode="Mesh" modelUrl={modelUrl} filename={modelName} />;
    return (
      <div className="flex h-full flex-col bg-black">
        <video
          ref={videoRef}
          key={activeVideo?.url}
          src={activeVideo?.url}
          controls
          autoPlay={!reducedMotion}
          playsInline
          onEnded={handleVideoEnded}
          className="min-h-0 flex-1 w-full object-contain"
          aria-label={`${title} output${videoFiles.length > 1 ? ` shot ${selectedShot + 1}` : ''}`}
        />
        {workflow === 'shot' && videoFiles.length > 1 && (
          <div className="border-t border-white/10 bg-[#08080a] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 gap-2 overflow-x-auto">
                {videoFiles.map((file, index) => {
                  const shot = shotResults[index];
                  return (
                    <button
                      key={`${file.filename}-${index}`}
                      type="button"
                      onClick={() => setSelectedShot(index)}
                      aria-pressed={selectedShot === index}
                      className={`min-w-[150px] rounded-xl border px-3 py-2 text-left transition-all ${selectedShot === index ? 'border-white/30 bg-white/10' : 'border-white/10 bg-white/[0.025] hover:bg-white/5'}`}
                    >
                      <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/35">Shot {index + 1}</div>
                      <div className="mt-1 truncate text-xs font-bold text-white">{shot?.title || `Sequence Shot ${index + 1}`}</div>
                      <div className="mt-1 text-[10px] font-mono text-white/40">{shot?.actualDurationSec ?? shot?.duration ?? projectItem?.paramsShot?.shots[index]?.duration ?? '?'} sec{shot?.workerName ? ` · ${shot.workerName}` : ''}</div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPlaySequence((value) => !value)}
                aria-pressed={playSequence}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-mono text-white/65 hover:text-white"
              >
                {playSequence ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playSequence ? 'AUTO ADVANCE' : 'PLAY ONE'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-mono backdrop-blur-md ${outputAvailable ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
        <div className="flex min-w-0 items-center gap-2">
          {outputAvailable ? <Sparkles className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span className="truncate font-semibold">{outputAvailable ? 'LOCAL COMFYUI OUTPUT READY' : 'WORKFLOW FINISHED WITHOUT A VIEWABLE OUTPUT'}</span>
          {resolvedResult?.promptId && <span className="hidden opacity-50 sm:inline">ID {resolvedResult.promptId.slice(0, 8)}</span>}
        </div>
        {onGoAssets && <button type="button" onClick={onGoAssets} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-3 py-1 font-bold hover:bg-white/15"><FolderOpen className="h-3.5 w-3.5" /> ASSETS <ArrowUpRight className="h-3.5 w-3.5" /></button>}
      </div>

      {resolvedResult?.warning && <div className="flex gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-100/80" role="status"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" /><span>{resolvedResult.warning}</span></div>}

      <section className="dreamframe-card relative flex flex-col gap-6 p-5 shadow-2xl sm:p-8" aria-labelledby="output-title">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${outputAvailable ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <div>
              <h1 id="output-title" className="font-grotesk text-2xl font-black text-white sm:text-3xl">{title}</h1>
              {workflow === 'shot' && <p className="mt-1 text-xs text-white/40">{videoFiles.length} edited scene{videoFiles.length === 1 ? '' : 's'} generated in sequence</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {outputDuration ? <StatPill icon={Film} label="Output" value={`${outputDuration} sec`} /> : null}
            <StatPill icon={Clock3} label="Render time" value={formatRenderDuration(renderDurationMs)} />
            <StatPill icon={Download} label="Files" value={String(outputFiles.length)} />
          </div>
        </div>

        {projectItem && (
          <div className="flex w-fit rounded-xl border border-white/10 bg-black/40 p-1" role="group" aria-label="Project view">
            {([['output', 'Output', Film], ['workflow', 'Workflow', WorkflowIcon]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11px] font-mono uppercase tracking-[0.12em] transition-all ${
                  tab === key ? 'bg-white font-bold text-black shadow-lg' : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </div>
        )}

        {tab === 'workflow' && projectItem ? (
          <WorkflowView project={projectItem} />
        ) : (
          <div className="relative h-[500px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black/90 sm:h-[580px]">{renderOutput()}</div>
        )}

        <div className={`flex flex-wrap items-center justify-between gap-4 ${tab === 'workflow' ? 'hidden' : ''}`}>
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={onCreateAnother} className="flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-medium text-white hover:border-white/40 hover:bg-white/5"><Plus className="h-4 w-4" /> Create Another</button>
            {workflow === 'shot' && onEditScenes && (
              <button type="button" onClick={onEditScenes} className="flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-neutral-200"><Film className="h-4 w-4" /> Edit Scenes</button>
            )}
          </div>

          <div className="relative flex flex-wrap items-center justify-end gap-2.5">
            {gaussianUrl && <a href={gaussianUrl} download={gaussianName} onClick={markDownloaded} className="flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-neutral-200"><Download className="h-4 w-4" />Download Gaussian PLY</a>}
            {workflow === 'storyboard' && activeVideo && <a href={activeVideo.url} download={activeVideo.filename} onClick={markDownloaded} className="flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-neutral-200"><Download className="h-4 w-4" />Download Animatic</a>}
            {workflow === 'shot' && videoFiles.map((file, index) => <a key={file.filename} href={file.url} download={file.filename} onClick={markDownloaded} className={`flex items-center gap-2 rounded-full px-4 py-3 text-xs font-semibold ${index === selectedShot ? 'bg-white text-black' : 'border border-white/15 bg-white/5 text-white hover:bg-white/10'}`}><Download className="h-3.5 w-3.5" />Shot {index + 1}</a>)}
            {untexturedFile && <a href={untexturedFile.url} download={untexturedFile.filename} onClick={markDownloaded} className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white"><Download className="h-4 w-4" />Untextured GLB</a>}
            {texturedFile && <a href={texturedFile.url} download={texturedFile.filename} onClick={markDownloaded} className="flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black hover:bg-neutral-200"><Download className="h-4 w-4" />Textured GLB</a>}
            {otherFiles.length > 0 && <button ref={moreTriggerRef} type="button" onClick={() => setShowMore((value) => !value)} aria-expanded={showMore} aria-haspopup="menu" className="rounded-full border border-white/15 bg-white/5 px-4 py-3.5 text-sm text-white/70 hover:bg-white/10">More</button>}

            <AnimatePresence>
              {showMore && otherFiles.length > 0 && (
                <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: -8 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} ref={morePanelRef} role="menu" aria-label="Other output files" className="absolute bottom-full right-0 z-50 mb-3 w-80 rounded-2xl border border-white/20 bg-[#0a0a0c] p-4 font-mono text-xs shadow-2xl">
                  <span className="text-[10px] uppercase tracking-wider text-white/40">OTHER COMFYUI OUTPUTS</span>
                  <div className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-auto">
                    {otherFiles.map((file) => <a key={`${file.type}:${file.subfolder}:${file.filename}`} href={file.url} download={file.filename} onClick={markDownloaded} role="menuitem" className="flex w-full items-center justify-between gap-3 rounded-xl bg-white/5 p-2.5 text-white/90 hover:bg-white/15"><span className="truncate">{file.filename}</span><span className="uppercase text-white/40">{file.extension}</span></a>)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {downloadSuccess && <div className="absolute right-0 top-full mt-2 flex items-center gap-2 whitespace-nowrap rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400" role="status"><Check className="h-3.5 w-3.5" />Download started</div>}
          </div>
        </div>
      </section>
    </motion.div>
  );
};

function StatPill({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2"><div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-white/30"><Icon className="h-3 w-3" />{label}</div><div className="mt-0.5 text-xs font-bold text-white/80">{value}</div></div>;
}

function MissingOutput({ workflow }: { workflow: WorkflowCreationType }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center" role="alert">
      <div className="max-w-xl rounded-2xl border border-rose-400/25 bg-rose-500/10 p-6">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-300" />
        <h2 className="mt-3 text-xl font-black text-white">Output file is missing</h2>
        <p className="mt-2 text-xs leading-relaxed text-rose-100/70">The {workflow} workflow finished, but DreamFrame could not resolve a supported output file from ComfyUI. Check the output folder and workflow export nodes before rerunning.</p>
      </div>
    </div>
  );
}
