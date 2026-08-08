import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Brush,
  Eraser,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Loader2,
  Maximize2,
  Palette,
  Repeat,
  ScanFace,
  Trees,
  X,
} from 'lucide-react';
import type { AssetRecord } from '../types';
import { runGraph, uploadImage } from '../lib/comfyApi';
import type { ComfyOutputFile } from '../lib/comfyApi';
import {
  DEFAULT_NEGATIVE,
  EditPoint,
  EditTool,
  buildFaceLock,
  buildRelight,
  buildSam2Image,
  buildUpscale,
  buildVaceEdit,
} from '../lib/editGraphs';
import {
  EMPTY_ENVIRONMENT,
  EditEnvironment,
  blockedReason,
  capabilityOf,
  probeEditEnvironment,
} from '../lib/editCapabilities';
import { loadRenderWorkers, RenderWorker } from '../lib/renderWorkers';
import { refreshTasksNow } from '../lib/taskStore';

interface EditViewProps {
  assets: AssetRecord[];
  onCreated: (asset: AssetRecord) => void;
}

interface ToolSpec {
  key: EditTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  needsPoints: boolean;
  needsPrompt: boolean;
}

const TOOLS: ToolSpec[] = [
  { key: 'background', label: 'Background', icon: Trees, blurb: 'Keep the subject, rebuild everything behind it.', needsPoints: true, needsPrompt: true },
  { key: 'replace', label: 'Replace', icon: Repeat, blurb: 'Swap the thing you click for something else.', needsPoints: true, needsPrompt: true },
  { key: 'remove', label: 'Remove', icon: Eraser, blurb: 'Take it out and rebuild what was behind it.', needsPoints: true, needsPrompt: false },
  { key: 'inpaint', label: 'Inpaint', icon: Brush, blurb: 'Change one area and leave the rest alone.', needsPoints: true, needsPrompt: true },
  { key: 'relight', label: 'Relight', icon: Lightbulb, blurb: 'Change the light without changing the subject.', needsPoints: false, needsPrompt: true },
  { key: 'style', label: 'Style', icon: Palette, blurb: 'Restyle the whole frame.', needsPoints: false, needsPrompt: true },
  { key: 'upscale', label: 'Upscale', icon: Maximize2, blurb: 'Double the resolution with a sharpening model.', needsPoints: false, needsPrompt: false },
  { key: 'facelock', label: 'Face lock', icon: ScanFace, blurb: 'Hold one face steady across every frame.', needsPoints: false, needsPrompt: false },
];

const RELIGHT_PRESETS = [
  'warm golden hour light',
  'cool blue night, moonlight',
  'soft overcast daylight',
  'dramatic low-key lighting, single source',
  'neon city glow',
];

const STYLE_PRESETS = ['cinematic film look', 'hand-painted illustration', 'gritty documentary', 'high-contrast noir'];

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);

function isVideoAsset(asset: AssetRecord): boolean {
  if (asset.previewKind === 'video') return true;
  const extension = (asset.downloadFilename || asset.sourceFilename || '').split('.').pop()?.toLowerCase();
  return extension ? VIDEO_EXTENSIONS.has(extension) : false;
}

function editableUrl(asset: AssetRecord): string | undefined {
  return asset.downloadUrl || asset.sourceImage || asset.thumbnailUrl || undefined;
}

export const EditView: React.FC<EditViewProps> = ({ assets, onCreated }) => {
  const [worker, setWorker] = useState<RenderWorker | null>(null);
  const [environment, setEnvironment] = useState<EditEnvironment>(EMPTY_ENVIRONMENT);
  const [sourceId, setSourceId] = useState('');
  const [tool, setTool] = useState<EditTool>('style');
  const [prompt, setPrompt] = useState('');
  const [strength, setStrength] = useState(0.85);
  const [points, setPoints] = useState<EditPoint[]>([]);
  const [maskUrl, setMaskUrl] = useState('');
  const [segmenting, setSegmenting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [faceAssetId, setFaceAssetId] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);

  const editable = useMemo(() => assets.filter((asset) => Boolean(editableUrl(asset))), [assets]);
  const images = useMemo(() => editable.filter((asset) => !isVideoAsset(asset)), [editable]);
  const source = editable.find((asset) => asset.id === sourceId);
  const sourceIsVideo = source ? isVideoAsset(source) : false;
  const spec = TOOLS.find((item) => item.key === tool)!;

  useEffect(() => {
    if (!sourceId && editable.length > 0) setSourceId(editable[0].id);
  }, [editable.length]);

  useEffect(() => {
    let active = true;
    void loadRenderWorkers()
      .then(async (response) => {
        const first = response.workers[0];
        if (!active || !first) return;
        setWorker(first);
        const probed = await probeEditEnvironment(first.apiBase);
        if (active) setEnvironment(probed);
      })
      .catch(() => {
        if (active) setEnvironment({ ...EMPTY_ENVIRONMENT, probed: true, error: 'Could not read the render PC list.' });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPoints([]);
    setMaskUrl('');
    setError('');
  }, [sourceId, tool]);

  const blocked = blockedReason(environment, tool, sourceIsVideo);

  const missingInput = (() => {
    if (!source) return 'Pick something to edit from the list on the left.';
    if (spec.needsPoints && points.length === 0) return 'Click the subject in the picture. Alt-click marks “not this”.';
    if (spec.needsPoints && !maskUrl && !segmenting) return 'Select the subject to build a mask before applying.';
    if (spec.needsPrompt && !prompt.trim()) {
      if (tool === 'background') return 'Describe the new background.';
      if (tool === 'replace') return 'Describe what should replace it.';
      if (tool === 'inpaint') return 'Describe what should appear there.';
      return 'Describe the change.';
    }
    if (tool === 'facelock' && !faceAssetId) return 'Choose a face reference image.';
    return null;
  })();

  const uploadAsset = async (asset: AssetRecord): Promise<string> => {
    const url = editableUrl(asset);
    if (!url) throw new Error('That item has no file to send.');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not read that file.');
    const blob = await response.blob();
    const filename = asset.downloadFilename || asset.sourceFilename || `${asset.title}.png`;
    const uploaded = await uploadImage(blob, filename, undefined, worker?.apiBase);
    return uploaded.name;
  };

  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!spec.needsPoints || !stageRef.current) return;
    const media = stageRef.current.querySelector('img, video') as HTMLImageElement | HTMLVideoElement | null;
    if (!media) return;
    const box = media.getBoundingClientRect();
    const natural = media instanceof HTMLImageElement
      ? { width: media.naturalWidth, height: media.naturalHeight }
      : { width: (media as HTMLVideoElement).videoWidth, height: (media as HTMLVideoElement).videoHeight };
    if (!natural.width || !natural.height) return;
    // The mask is built in the file's own pixels, so the click is mapped out of display space.
    const x = ((event.clientX - box.left) / box.width) * natural.width;
    const y = ((event.clientY - box.top) / box.height) * natural.height;
    if (x < 0 || y < 0 || x > natural.width || y > natural.height) return;
    setPoints([...points, { x, y, positive: !event.altKey }]);
  };

  const runSegment = async () => {
    if (!source || points.length === 0) return;
    setSegmenting(true);
    setError('');
    setStatus('Selecting the subject…');
    try {
      const name = await uploadAsset(source);
      const result = await runGraph({
        graph: buildSam2Image({ imageName: name, points }),
        name: 'click-to-select',
        apiBase: worker?.apiBase,
        tag: { workflow: 'edit', title: 'Click-to-select' },
        timeoutMinutes: 10,
      });
      const mask = result.outputFiles.find((file) => file.extension === 'png') || result.outputFiles[0];
      if (!mask) throw new Error('Segmentation produced no mask.');
      setMaskUrl(mask.url);
      setStatus('Subject selected.');
    } catch (segmentError) {
      setError(segmentError instanceof Error ? segmentError.message : 'Could not select the subject.');
      setStatus('');
    } finally {
      setSegmenting(false);
      refreshTasksNow();
    }
  };

  const buildGraphFor = async (): Promise<{ graph: Record<string, any>; name: string }> => {
    if (!source) throw new Error('Nothing selected.');
    const sourceName = await uploadAsset(source);
    const files = environment.files;
    const canvas = { width: 832, height: 480 };

    if (tool === 'upscale') {
      return {
        name: 'upscale',
        graph: buildUpscale({ sourceName, isVideo: sourceIsVideo, model: files.upscale || '4x-UltraSharp.pth' }),
      };
    }
    if (tool === 'facelock') {
      const face = assets.find((asset) => asset.id === faceAssetId);
      if (!face) throw new Error('Choose a face reference image.');
      return {
        name: 'face lock',
        graph: buildFaceLock({ sourceName, isVideo: sourceIsVideo, faceImageName: await uploadAsset(face) }),
      };
    }
    if (tool === 'relight') {
      return {
        name: 'relight',
        graph: buildRelight({
          imageName: sourceName,
          prompt,
          width: canvas.width,
          height: canvas.height,
          checkpoint: files.sd15 || '',
          icLightModel: files.icLight || '',
        }),
      };
    }

    let maskName: string | undefined;
    if (spec.needsPoints && maskUrl) {
      const maskResponse = await fetch(maskUrl);
      const maskBlob = await maskResponse.blob();
      const uploadedMask = await uploadImage(maskBlob, `dreamframe-mask-${Date.now()}.png`, undefined, worker?.apiBase);
      maskName = uploadedMask.name;
    }

    const promptFor: Record<string, string> = {
      background: prompt,
      replace: prompt,
      remove: 'clean plate, the background continuing naturally, nothing in its place',
      inpaint: prompt,
      style: prompt,
    };

    return {
      name: tool,
      graph: buildVaceEdit({
        sourceName,
        isVideo: sourceIsVideo,
        prompt: promptFor[tool] ?? prompt,
        negative: DEFAULT_NEGATIVE,
        width: canvas.width,
        height: canvas.height,
        length: sourceIsVideo ? 81 : 1,
        maskName,
        strength,
        vaceModel: files.vace || '',
        textEncoder: files.textEncoder || '',
        vae: files.wanVae || '',
      }),
    };
  };

  const apply = async () => {
    if (!source || missingInput || blocked) return;
    setBusy(true);
    setError('');
    setStatus('Sending the edit to ComfyUI…');
    try {
      const { graph, name } = await buildGraphFor();
      const result = await runGraph({
        graph,
        name,
        apiBase: worker?.apiBase,
        tag: { workflow: 'edit', title: `${spec.label} · ${source.title}` },
        onProgress: (progress) => setStatus(progress.status),
      });
      const primary: ComfyOutputFile | undefined = result.outputFiles[0];
      if (!primary) throw new Error('The edit finished but produced no file.');

      const now = Date.now();
      onCreated({
        ...source,
        id: `asset-edit-${now}`,
        title: `${source.title} · ${spec.label}`,
        kind: 'output',
        categoryLabel: `${spec.label.toUpperCase()} EDIT`,
        badge: `${primary.extension.toUpperCase()} EDIT`,
        format: primary.extension.toUpperCase(),
        downloadUrl: primary.url,
        downloadFilename: primary.filename,
        outputFiles: result.outputFiles,
        outputAvailability: 'available',
        uploadedAt: new Date(now).toLocaleString(),
        createdAtEpoch: now,
        isGenerated: true,
        versionOf: source.id,
        editOp: tool,
        blobKey: undefined,
      });
      setStatus(`${spec.label} applied — saved as a new version.`);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'The edit failed.');
      setStatus('');
    } finally {
      setBusy(false);
      refreshTasksNow();
    }
  };

  const versions = useMemo(() => {
    if (!source) return [];
    const rootOf = (asset: AssetRecord): string => {
      const parent = asset.versionOf ? assets.find((item) => item.id === asset.versionOf) : undefined;
      return parent ? rootOf(parent) : asset.id;
    };
    const root = rootOf(source);
    return assets.filter((asset) => rootOf(asset) === root);
  }, [assets, source]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      <section className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03)_36%,rgba(12,12,18,0.96)_74%)] p-6 shadow-2xl shadow-black/40 sm:p-8">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.22em] text-white/55">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <Layers className="h-3.5 w-3.5 text-violet-300" />Local editing suite
          </span>
          {environment.probed && (
            <span>{environment.capabilities.filter((capability) => capability.ok).length} of {TOOLS.length} tools ready</span>
          )}
        </div>
        <h1 className="mt-4 font-grotesk text-3xl font-black tracking-tight text-white sm:text-5xl">Edit</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/62">
          Change a rendered shot without rendering it again. Every edit is posted to your own ComfyUI and saved
          as a new version, so the original is never overwritten.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className="rounded-2xl border border-white/12 bg-neutral-950/70 p-3">
          <div className="mb-2 px-1 text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">Library</div>
          <div className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto">
            {editable.length === 0 && (
              <p className="px-1 py-6 text-center text-xs text-white/35">Nothing to edit yet. Render something or upload a file in Assets.</p>
            )}
            {editable.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => setSourceId(asset.id)}
                aria-pressed={asset.id === sourceId}
                className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all ${
                  asset.id === sourceId ? 'border-violet-300/40 bg-violet-500/10' : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
                  {asset.thumbnailUrl
                    ? <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center"><ImageIcon className="h-4 w-4 text-white/25" /></div>}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-white">{asset.title}</div>
                  <div className="truncate text-[9px] font-mono uppercase tracking-[0.12em] text-white/35">
                    {isVideoAsset(asset) ? 'video' : 'image'}{asset.versionOf ? ' · version' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex flex-col gap-3">
          <div
            ref={stageRef}
            onClick={handleStageClick}
            className={`relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-black ${spec.needsPoints ? 'cursor-crosshair' : ''}`}
          >
            {source ? (
              sourceIsVideo
                ? <video src={editableUrl(source)} controls playsInline className="max-h-[520px] w-full object-contain" />
                : <img src={editableUrl(source)} alt={source.title} className="max-h-[520px] w-full object-contain" />
            ) : (
              <div className="p-10 text-center text-xs text-white/35">Pick something to edit.</div>
            )}

            {maskUrl && (
              <img
                src={maskUrl}
                alt="Selected area"
                className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-45 mix-blend-screen"
              />
            )}

            {points.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[10px] font-mono text-white/70">
                {points.length} point{points.length === 1 ? '' : 's'} · {points.filter((point) => !point.positive).length} excluded
              </div>
            )}
          </div>

          {spec.needsPoints && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runSegment()}
                disabled={points.length === 0 || segmenting || !environment.segmentReady}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
              >
                {segmenting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brush className="h-3.5 w-3.5" />}
                select subject
              </button>
              <button
                type="button"
                onClick={() => { setPoints([]); setMaskUrl(''); }}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-mono uppercase tracking-[0.12em] text-white/55 hover:text-white"
              >
                clear points
              </button>
              {!environment.segmentReady && environment.probed && (
                <span className="text-[10px] text-amber-200/80">Click-to-select needs the segment-anything-2 node pack.</span>
              )}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4 rounded-2xl border border-white/12 bg-neutral-950/70 p-4">
          <div>
            <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">Tools</div>
            <div className="grid grid-cols-2 gap-2">
              {TOOLS.map((item) => {
                const capability = capabilityOf(environment, item.key);
                const unavailable = environment.probed && environment.online && capability && !capability.ok;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTool(item.key)}
                    aria-pressed={tool === item.key}
                    title={item.blurb}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                      tool === item.key
                        ? 'border-violet-300/40 bg-violet-500/12 text-white'
                        : 'border-white/8 bg-white/[0.02] text-white/60 hover:bg-white/[0.05] hover:text-white'
                    } ${unavailable ? 'opacity-45' : ''}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[10px] font-bold">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/35">{spec.blurb}</p>
          </div>

          {spec.needsPrompt && (
            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">
                {tool === 'background' ? 'New background' : tool === 'replace' ? 'Replace with' : tool === 'relight' ? 'Lighting' : 'Describe it'}
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={3}
                placeholder={tool === 'background' ? 'a misty pine forest at dawn' : 'describe the change'}
                className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-black/45 p-2.5 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/30"
              />
            </label>
          )}

          {(tool === 'relight' || tool === 'style') && (
            <div className="flex flex-wrap gap-1.5">
              {(tool === 'relight' ? RELIGHT_PRESETS : STYLE_PRESETS).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPrompt(preset)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] text-white/55 hover:bg-white/[0.08] hover:text-white"
                >
                  {preset.split(',')[0]}
                </button>
              ))}
            </div>
          )}

          {tool === 'facelock' && (
            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">Face reference</span>
              <select
                value={faceAssetId}
                onChange={(event) => setFaceAssetId(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs text-white outline-none"
              >
                <option value="">choose an image…</option>
                {images.map((image) => <option key={image.id} value={image.id}>{image.title}</option>)}
              </select>
            </label>
          )}

          {['background', 'replace', 'inpaint', 'style'].includes(tool) && (
            <label className="block">
              <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">
                How strong — {strength.toFixed(2)}
              </span>
              <input
                type="range"
                min={0.4}
                max={1}
                step={0.05}
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
                className="mt-2 w-full accent-white"
              />
            </label>
          )}

          <div className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-3">
            {(blocked || missingInput) && (
              <div className="flex gap-2 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100/85">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{blocked || missingInput}</span>
              </div>
            )}
            {error && (
              <div className="flex gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[10px] leading-relaxed text-rose-100">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span>
              </div>
            )}
            {status && !error && <div className="px-1 text-[10px] font-mono text-white/45">{status}</div>}
            <button
              type="button"
              onClick={() => void apply()}
              disabled={busy || Boolean(blocked) || Boolean(missingInput)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-bold tracking-[0.14em] text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'APPLYING…' : 'APPLY'}
            </button>
          </div>

          {versions.length > 1 && (
            <div className="border-t border-white/10 pt-3">
              <div className="mb-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">Versions</div>
              <div className="flex flex-col gap-1">
                {versions.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSourceId(version.id)}
                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${
                      version.id === sourceId ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5'
                    }`}
                  >
                    <span className="min-w-0 truncate">{version.title}</span>
                    <span className="shrink-0 font-mono text-[9px] text-white/30">
                      {version.editOp || 'original'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </motion.div>
  );
};
