import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Box,
  Check,
  Download,
  Eye,
  File,
  Film,
  FolderOpen,
  Grid,
  HardDrive,
  Image as ImageIcon,
  Layers,
  List,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { AssetRecord, EnabledWorkflowCreationType, WorkflowCreationType } from '../types';
import { INITIAL_ASSETS } from '../data/samples';
import {
  classifyAssetFile,
  humanFileSize,
  isGeneratedOutput,
  parseHumanFileSize,
  workflowLabel,
} from '../lib/assetUtils';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { deleteAssetBlob, saveAssetBlob } from '../lib/storage';

interface AssetsViewProps {
  assets?: AssetRecord[];
  onDeleteAsset?: (id: string) => void;
  onAddAsset?: (asset: AssetRecord) => void;
  onUpdateAsset?: (asset: AssetRecord) => void;
  onSelectWorkflow: (workflow: WorkflowCreationType) => void;
  onViewAsset?: (asset: AssetRecord) => void;
  onUseSourceAsset?: (asset: AssetRecord) => void;
}

const IMAGE_WORKFLOWS: EnabledWorkflowCreationType[] = ['model', 'shot', 'storyboard', '3d'];

async function createImageThumbnail(file: File, maxDimension = 1200): Promise<string> {
  if (!file.type.startsWith('image/') || /(?:exr|hdr)$/i.test(file.name)) return '';
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the asset thumbnail.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.78);
}

function triggerDownload(url: string | undefined, filename?: string) {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function AssetPreview({ asset, compact = false }: { asset: AssetRecord; compact?: boolean }) {
  const className = `h-full w-full object-cover ${compact ? '' : 'brightness-90 group-hover:scale-105 group-hover:brightness-100 transition-all duration-500'}`;

  // Generated output cards intentionally keep the source/reference picture. The real output opens in View Output.
  if (asset.kind === 'output' && asset.thumbnailUrl) {
    return <img src={asset.thumbnailUrl} alt="" className={className} />;
  }

  if (asset.previewKind === 'image' && asset.thumbnailUrl) {
    return <img src={asset.thumbnailUrl} alt="" className={className} />;
  }

  if (asset.previewKind === 'video' && asset.sourceImage) {
    return <video src={asset.sourceImage} className={className} muted loop playsInline aria-label={`${asset.title} video preview`} />;
  }

  const Icon = asset.previewKind === 'gaussian' ? Box : asset.previewKind === 'model' ? Layers : File;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(99,102,241,0.22),rgba(6,8,12,0.98)_62%)] text-center">
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-white/80">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      {!compact && (
        <div className="mt-3 px-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/40">{asset.kind === 'output' ? 'Workflow Output' : 'Source Asset'}</div>
          <div className="mt-1 text-xs font-semibold text-white/80">{asset.format}</div>
        </div>
      )}
    </div>
  );
}

export const AssetsView: React.FC<AssetsViewProps> = ({
  assets: propAssets,
  onDeleteAsset,
  onAddAsset,
  onUpdateAsset,
  onSelectWorkflow,
  onViewAsset,
  onUseSourceAsset,
}) => {
  const [localAssets, setLocalAssets] = useState<AssetRecord[]>(INITIAL_ASSETS);
  const assets = propAssets || localAssets;
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'title' | 'size'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isUploading, setIsUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [uploadTarget, setUploadTarget] = useState<EnabledWorkflowCreationType | ''>('');
  const [uploadError, setUploadError] = useState('');
  const [isSavingUpload, setIsSavingUpload] = useState(false);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [inspectAsset, setInspectAsset] = useState<AssetRecord | null>(null);
  const uploadDialogRef = useRef<HTMLDivElement>(null);
  const inspectDialogRef = useRef<HTMLDivElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const [relinkAssetId, setRelinkAssetId] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState('');

  useDialogA11y(isUploading, uploadDialogRef, () => closeUpload());
  useDialogA11y(Boolean(inspectAsset), inspectDialogRef, () => setInspectAsset(null));

  const categories = [
    { id: 'all', label: 'ALL ASSETS' },
    { id: 'output', label: 'GENERATED OUTPUTS' },
    { id: 'source', label: 'SOURCE ASSETS' },
    { id: '3d', label: 'GAUSSIANS' },
    { id: 'model', label: '3D MODELS' },
    { id: 'shot', label: 'VIDEOS' },
    { id: 'storyboard', label: 'STORYBOARDS' },
  ];

  const filteredAssets = useMemo(() => {
    return [...assets]
      .filter((asset) => {
        const matchesCategory =
          selectedCategory === 'all'
            ? true
            : selectedCategory === 'output'
              ? asset.kind === 'output'
              : selectedCategory === 'source'
                ? asset.kind === 'source'
                : asset.category === selectedCategory;
        const haystack = `${asset.title} ${asset.categoryLabel} ${asset.format} ${asset.badge}`.toLowerCase();
        return matchesCategory && haystack.includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title);
        if (sortBy === 'size') return parseHumanFileSize(b.fileSize, b.fileSizeBytes) - parseHumanFileSize(a.fileSize, a.fileSizeBytes);
        return (b.createdAtEpoch || 0) - (a.createdAtEpoch || 0);
      });
  }, [assets, searchQuery, selectedCategory, sortBy]);

  const stats = {
    total: assets.length,
    outputs: assets.filter(isGeneratedOutput).length,
    sources: assets.filter((asset) => asset.kind === 'source').length,
    downloadable: assets.filter((asset) => Boolean(asset.downloadUrl)).length,
  };

  const closeUpload = () => {
    setIsUploading(false);
    setPendingUpload(null);
    setUploadTarget('');
    setUploadError('');
    setIsSavingUpload(false);
  };

  const chooseFile = (file?: File) => {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setUploadError('The selected file is larger than 200 MB. Store very large workflow outputs in the ComfyUI output folder instead.');
      return;
    }
    const classification = classifyAssetFile(file);
    setPendingUpload(file);
    setUploadTarget(classification.workflowTarget || '');
    setUploadError('');
  };

  const savePendingUpload = async () => {
    if (!pendingUpload) return;
    setIsSavingUpload(true);
    setUploadError('');
    try {
      const detected = classifyAssetFile(pendingUpload);
      const target = uploadTarget || detected.workflowTarget;
      const now = Date.now();
      const assetId = `asset-source-${now}`;
      const blobKey = `source-${assetId}`;
      const category = target || detected.category;
      const previewableImage = detected.previewKind === 'image';
      const previewableVideo = detected.previewKind === 'video';
      await saveAssetBlob(blobKey, pendingUpload);
      const objectUrl = URL.createObjectURL(pendingUpload);
      const thumbnail = previewableImage ? await createImageThumbnail(pendingUpload) : '';
      const asset: AssetRecord = {
        id: assetId,
        title: pendingUpload.name.replace(/\.[^/.]+$/, ''),
        kind: 'source',
        category,
        workflowTarget: target || undefined,
        categoryLabel: target ? `${workflowLabel(target).toUpperCase()} SOURCE` : detected.categoryLabel,
        badge: 'SOURCE',
        thumbnailUrl: thumbnail,
        previewKind: detected.previewKind,
        fileSize: humanFileSize(pendingUpload.size),
        fileSizeBytes: pendingUpload.size,
        dimensions: target ? `Input for ${workflowLabel(target)}` : 'Reference or local source file',
        format: detected.format,
        mimeType: pendingUpload.type,
        uploadedAt: new Date(now).toLocaleString(),
        createdAtEpoch: now,
        sourceImage: objectUrl,
        sourceFilename: pendingUpload.name,
        blobKey,
        downloadUrl: objectUrl,
        downloadFilename: pendingUpload.name,
      };
      if (previewableVideo) asset.thumbnailUrl = '';
      if (onAddAsset) onAddAsset(asset);
      else setLocalAssets((previous) => [asset, ...previous]);
      closeUpload();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not add the asset to the library.');
      setIsSavingUpload(false);
    }
  };

  const deleteAsset = (id: string) => {
    const asset = assets.find((item) => item.id === id);
    if (asset && !window.confirm(`Remove “${asset.title}” from the DreamFrame library? The original ComfyUI output is not deleted.`)) return;
    if (asset?.sourceImage?.startsWith('blob:')) URL.revokeObjectURL(asset.sourceImage);
    void deleteAssetBlob(asset?.blobKey);
    if (onDeleteAsset) onDeleteAsset(id);
    else setLocalAssets((previous) => previous.filter((item) => item.id !== id));
  };

  const viewOrUse = (asset: AssetRecord) => {
    if (asset.kind === 'output') {
      onViewAsset?.(asset);
      return;
    }
    if (asset.workflowTarget) {
      onUseSourceAsset?.(asset);
      return;
    }
    setInspectAsset(asset);
  };

  const relinkOutput = async (file?: File) => {
    if (!file || !relinkAssetId) return;
    const asset = assets.find((item) => item.id === relinkAssetId);
    if (!asset) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || 'file';
    const allowed = asset.previewKind === 'video'
      ? ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']
      : asset.previewKind === 'model'
        ? ['glb', 'gltf']
        : asset.previewKind === 'gaussian'
          ? ['ply']
          : [extension];
    if (!allowed.includes(extension)) {
      setRelinkError(`This output expects ${allowed.map((value) => value.toUpperCase()).join(' or ')}, not ${extension.toUpperCase()}.`);
      setRelinkAssetId(null);
      if (relinkInputRef.current) relinkInputRef.current.value = '';
      return;
    }
    setRelinkError('');
    const blobKey = `relinked-output-${asset.id}`;
    if (asset.sourceImage?.startsWith('blob:')) URL.revokeObjectURL(asset.sourceImage);
    if (asset.blobKey && asset.blobKey !== blobKey) await deleteAssetBlob(asset.blobKey);
    await saveAssetBlob(blobKey, file);
    const url = URL.createObjectURL(file);
    const outputFile = { filename: file.name, subfolder: '', type: 'output' as const, url, extension };
    const updated: AssetRecord = {
      ...asset,
      blobKey,
      downloadUrl: url,
      downloadFilename: file.name,
      outputFiles: [outputFile],
      outputAvailability: 'available',
      format: extension.toUpperCase(),
      fileSize: humanFileSize(file.size),
      fileSizeBytes: file.size,
      badge: 'RELINKED OUTPUT',
      generationResult: asset.generationResult ? { ...asset.generationResult, outputFiles: [outputFile] } : asset.generationResult,
    };
    onUpdateAsset?.(updated);
    setInspectAsset(updated);
    setRelinkAssetId(null);
    if (relinkInputRef.current) relinkInputRef.current.value = '';
  };

  const downloadAsset = (asset: AssetRecord) => {
    triggerDownload(asset.downloadUrl || asset.sourceImage, asset.downloadFilename || asset.sourceFilename);
    setDownloadedId(asset.id);
    window.setTimeout(() => setDownloadedId(null), 1600);
  };

  const categoryIcon = (asset: AssetRecord) => {
    if (asset.category === '3d') return Box;
    if (asset.category === 'model' || asset.category === 'mesh') return Layers;
    if (asset.category === 'shot' || asset.category === 'storyboard') return Film;
    if (asset.category === 'hdri') return Sun;
    return ImageIcon;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      <section className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03)_36%,rgba(12,12,18,0.96)_74%)] p-6 shadow-2xl shadow-black/40 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(129,140,248,0.16),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_28%)]" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.22em] text-white/55">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                <FolderOpen className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
                Persistent local library
              </span>
              <span>{assets.length} items tracked</span>
            </div>
            <h1 className="mt-4 font-grotesk text-3xl font-black tracking-tight text-white sm:text-5xl">Asset Library</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/62 sm:text-[15px]">
              Keep source inputs and workflow outputs in one polished workspace. Output cards intentionally retain the source reference image, while View Output opens the actual rendered video, model, or Gaussian result.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5">Source and outputs separated</span>
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5">Relink missing ComfyUI files</span>
              <span className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5">Ready for reuse in workflows</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setIsUploading(true)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-xs font-bold tracking-[0.18em] text-black transition-all hover:bg-neutral-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Upload source
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total stored', value: `${stats.total}`, note: 'Library items', icon: HardDrive },
          { label: 'Generated outputs', value: `${stats.outputs}`, note: 'Workflow results', icon: Zap },
          { label: 'Source assets', value: `${stats.sources}`, note: 'Reusable inputs', icon: Upload },
          { label: 'Downloadable', value: `${stats.downloadable}`, note: 'Ready files', icon: Download },
        ].map((item) => {
          const StatIcon = item.icon;
          return (
            <div key={item.label} className="rounded-2xl border border-white/12 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-white/42">{item.label}</div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-2 text-white/70">
                  <StatIcon className="h-4 w-4" aria-hidden="true" />
                </div>
              </div>
              <div className="mt-4 text-2xl font-black text-white">{item.value}</div>
              <div className="mt-1 text-xs text-white/42">{item.note}</div>
            </div>
          );
        })}
      </div>

      <section className="rounded-[28px] border border-white/12 bg-neutral-950/70 p-4 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Asset categories">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                aria-pressed={selectedCategory === category.id}
                className={`rounded-full px-4 py-2 text-[11px] font-mono uppercase tracking-[0.18em] whitespace-nowrap transition-all ${
                  selectedCategory === category.id
                    ? 'bg-white text-black shadow-lg shadow-black/30'
                    : 'border border-white/10 bg-white/[0.03] text-white/66 hover:border-white/25 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1 sm:w-72">
              <span className="sr-only">Search assets</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search title, format, or badge..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-full border border-white/12 bg-black/45 py-2.5 pl-10 pr-4 text-xs text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
              />
            </label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              aria-label="Sort assets"
              className="rounded-xl border border-white/12 bg-black/45 px-3 py-2.5 text-xs text-white/80 outline-none"
            >
              <option value="newest">Newest</option>
              <option value="title">Title</option>
              <option value="size">File size</option>
            </select>
            <div className="flex items-center rounded-xl border border-white/12 bg-black/45 p-1" role="group" aria-label="Asset view mode">
              <button onClick={() => setViewMode('grid')} aria-pressed={viewMode === 'grid'} aria-label="Grid view" className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-white text-black' : 'text-white/40'}`}><Grid className="h-4 w-4" /></button>
              <button onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} aria-label="List view" className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-white text-black' : 'text-white/40'}`}><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3">
          <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/42">
            Showing <span className="font-bold text-white/78">{filteredAssets.length}</span> of <span className="font-bold text-white/78">{assets.length}</span> assets
          </div>
          <div className="text-xs text-white/38">
            {selectedCategory === 'all' ? 'All categories' : categories.find((category) => category.id === selectedCategory)?.label || 'Filtered'}
          </div>
        </div>
      </section>

      {filteredAssets.length === 0 ? (
        <div className="flex w-full flex-col items-center justify-center rounded-[28px] border border-dashed border-white/12 bg-neutral-950/50 py-20 text-center" role="status">
          <Grid className="mb-4 h-10 w-10 text-white/18" aria-hidden="true" />
          <h2 className="text-lg font-bold text-white/82">No matching assets found</h2>
          <p className="mt-2 max-w-md text-sm text-white/40">Try another category, clear the search, or upload a new source asset into the library.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredAssets.map((asset, index) => {
            const Icon = categoryIcon(asset);
            const primaryAction = asset.kind === 'output' ? 'VIEW OUTPUT' : asset.workflowTarget ? 'USE AS INPUT' : 'INSPECT';
            return (
              <motion.article
                key={asset.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.35 }}
                className="group overflow-hidden rounded-[26px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02)_18%,rgba(10,10,14,0.92)_100%)] p-4 shadow-xl shadow-black/25 transition-all hover:-translate-y-0.5 hover:border-white/22"
              >
                <button onClick={() => setInspectAsset(asset)} className="relative mb-4 block h-52 w-full overflow-hidden rounded-2xl border border-white/10 bg-black text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={`Inspect ${asset.title}`}>
                  <AssetPreview asset={asset} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/18 to-black/16" />
                  <div className="absolute left-3 top-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.16em] text-white/84 backdrop-blur-md">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {asset.categoryLabel}
                    </span>
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/45">{asset.kind === 'output' ? 'Workflow output' : 'Source asset'}</div>
                      <div className="mt-1 text-sm font-bold text-white">{asset.title}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.16em] ${asset.kind === 'output' && asset.outputAvailability === 'available' ? 'border-emerald-300/25 bg-emerald-500/75 text-white' : asset.kind === 'output' && asset.outputAvailability && asset.outputAvailability !== 'unknown' ? 'border-rose-300/25 bg-rose-500/75 text-white' : 'border-white/10 bg-black/55 text-white/84'}`}>
                      {asset.kind === 'output' ? (asset.outputAvailability === 'offline' ? 'COMFY OFFLINE' : asset.outputAvailability === 'missing' ? 'FILE MISSING' : asset.format) : asset.format}
                    </span>
                  </div>
                  <Eye className="absolute right-3 top-3 h-4 w-4 text-white/78 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </button>

                <div className="space-y-3 px-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-white">{asset.title}</h2>
                      <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.14em] text-white/35">{asset.badge}</p>
                    </div>
                    <div className="text-right text-[10px] font-mono text-white/35">{asset.uploadedAt}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-left">
                    {[
                      ['Size', asset.fileSize],
                      ['Format', asset.format],
                      ['Details', asset.dimensions],
                      ['Type', asset.kind.toUpperCase()],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                        <div className="text-[9px] font-mono uppercase tracking-[0.16em] text-white/34">{label}</div>
                        <div className="mt-1 text-xs font-semibold text-white/82 line-clamp-2">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4">
                  <button onClick={() => viewOrUse(asset)} className="flex-1 rounded-xl border border-white/10 bg-white px-3 py-2.5 text-xs font-mono font-bold text-black transition-all hover:bg-neutral-200">
                    <span className="inline-flex items-center justify-center gap-1.5">{primaryAction}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  </button>
                  <button onClick={() => downloadAsset(asset)} disabled={!asset.downloadUrl && !asset.sourceImage} aria-label={`Download ${asset.title}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-white/72 transition-all hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-white/20">
                    {downloadedId === asset.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Download className="h-4 w-4" />}
                  </button>
                  <button onClick={() => deleteAsset(asset.id)} aria-label={`Delete ${asset.title}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-white/40 transition-all hover:border-rose-400/25 hover:bg-rose-500/10 hover:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.article>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredAssets.map((asset) => {
            const Icon = categoryIcon(asset);
            const primaryAction = asset.kind === 'output' ? 'VIEW' : asset.workflowTarget ? 'USE' : 'INSPECT';
            return (
              <article key={asset.id} className="group flex items-center justify-between gap-4 rounded-2xl border border-white/12 bg-neutral-950/75 p-3 transition-all hover:border-white/22">
                <button onClick={() => setInspectAsset(asset)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black">
                    <AssetPreview asset={asset} compact />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-bold text-white">{asset.title}</h2>
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.16em] text-white/55">
                        <Icon className="h-3 w-3" />
                        {asset.kind}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.14em] text-white/36">{asset.categoryLabel} · {asset.format} · {asset.fileSize}</div>
                    <div className="mt-1 truncate text-xs text-white/48">{asset.dimensions}</div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => viewOrUse(asset)} className="rounded-xl border border-white/10 bg-white px-3 py-2 text-xs font-bold text-black transition-all hover:bg-neutral-200">{primaryAction}</button>
                  <button onClick={() => downloadAsset(asset)} disabled={!asset.downloadUrl && !asset.sourceImage} aria-label={`Download ${asset.title}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/72 disabled:cursor-not-allowed disabled:text-white/20"><Download className="h-3.5 w-3.5" /></button>
                  <button onClick={() => deleteAsset(asset.id)} aria-label={`Delete ${asset.title}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/40 transition-all hover:border-rose-400/25 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <input
        ref={relinkInputRef}
        type="file"
        className="sr-only"
        aria-label="Relink missing workflow output"
        accept="video/*,.glb,.gltf,.ply"
        onChange={(event) => void relinkOutput(event.target.files?.[0])}
      />

      <AnimatePresence>
        {inspectAsset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div ref={inspectDialogRef} role="dialog" aria-modal="true" aria-labelledby="asset-inspect-title" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full max-w-2xl rounded-2xl bg-neutral-900 border border-white/20 p-6 shadow-2xl relative flex flex-col gap-5">
              <button onClick={() => setInspectAsset(null)} aria-label="Close asset details" className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 text-white/60"><X className="w-4 h-4" /></button>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase"><span className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-indigo-300">{inspectAsset.kind}</span><span className="text-white/40">{inspectAsset.categoryLabel}</span></div>
              <h2 id="asset-inspect-title" className="text-xl font-bold text-white">{inspectAsset.title}</h2>
              <div className="w-full h-64 rounded-xl overflow-hidden border border-white/10 bg-black"><AssetPreview asset={inspectAsset} /></div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                {[
                  ['FORMAT', inspectAsset.format],
                  ['FILE SIZE', inspectAsset.fileSize],
                  ['TYPE', inspectAsset.kind.toUpperCase()],
                  ['CREATED', inspectAsset.uploadedAt],
                ].map(([label, value]) => <div key={label} className="p-3 rounded-xl bg-white/5 border border-white/10"><dt className="text-[10px] text-white/40">{label}</dt><dd className="mt-1 font-bold text-white truncate">{value}</dd></div>)}
              </dl>
              {relinkError && <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100" role="alert">{relinkError}</div>}
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-4">
                <button onClick={() => { const asset = inspectAsset; setInspectAsset(null); viewOrUse(asset); }} className="px-5 py-2.5 rounded-xl bg-white text-black text-xs font-mono font-bold flex items-center gap-2">
                  {inspectAsset.kind === 'output' ? 'VIEW OUTPUT' : inspectAsset.workflowTarget ? 'USE AS INPUT' : 'CLOSE'}
                  {inspectAsset.kind === 'output' || inspectAsset.workflowTarget ? <ArrowUpRight className="w-4 h-4" /> : null}
                </button>
                {inspectAsset.kind === 'output' && inspectAsset.outputAvailability !== 'available' && (
                  <button
                    onClick={() => {
                      setRelinkError('');
                      setRelinkAssetId(inspectAsset.id);
                      window.setTimeout(() => relinkInputRef.current?.click(), 0);
                    }}
                    className="px-5 py-2.5 rounded-xl border border-amber-300/20 bg-amber-500/10 text-amber-100 text-xs font-mono font-bold flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />RELINK OUTPUT
                  </button>
                )}
                {(inspectAsset.downloadUrl || inspectAsset.sourceImage) && <button onClick={() => downloadAsset(inspectAsset)} className="px-5 py-2.5 rounded-xl bg-white/5 text-white border border-white/10 text-xs font-mono font-bold flex items-center gap-2"><Download className="w-4 h-4" />DOWNLOAD</button>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUploading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div ref={uploadDialogRef} role="dialog" aria-modal="true" aria-labelledby="upload-title" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="w-full max-w-lg rounded-2xl bg-neutral-900 border border-white/20 p-6 shadow-2xl relative">
              <button onClick={closeUpload} aria-label="Close upload dialog" className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 text-white/60"><X className="w-4 h-4" /></button>
              <h2 id="upload-title" className="text-xl font-bold text-white flex items-center gap-2"><Upload className="w-5 h-5 text-indigo-400" />Add Source Asset</h2>
              <p className="mt-1 text-xs text-white/50 font-mono">Files are classified by extension and stored in the persistent local library.</p>

              <label
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}
                className="mt-6 w-full min-h-44 rounded-xl border-2 border-dashed border-white/20 hover:border-white/50 bg-white/[0.02] hover:bg-white/[0.05] transition-all flex flex-col items-center justify-center cursor-pointer p-4 text-center"
              >
                <input type="file" accept="image/*,video/*,.hdr,.exr,.ply,.glb,.gltf,.obj,.fbx,.stl,.usd,.usdz" onChange={(event) => chooseFile(event.target.files?.[0])} className="sr-only" />
                <div className="w-12 h-12 rounded-full bg-white/10 border border-white/20 flex items-center justify-center mb-3"><Plus className="w-6 h-6 text-white" /></div>
                <span className="text-sm font-bold text-white">{pendingUpload ? pendingUpload.name : 'Choose a file or drop it here'}</span>
                <span className="text-[11px] font-mono text-white/40 mt-1">Images, panoramas, videos, PLY and common 3D formats · 200 MB max</span>
              </label>

              {pendingUpload && (() => {
                const classification = classifyAssetFile(pendingUpload);
                const canChooseInput = classification.previewKind === 'image' || classification.format === 'HDR' || classification.format === 'EXR';
                const allowedTargets: EnabledWorkflowCreationType[] = classification.format === 'HDR' || classification.format === 'EXR' ? ['3d'] : IMAGE_WORKFLOWS;
                return (
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-xs font-mono">
                    <div className="flex items-center justify-between gap-3"><span className="text-white/50">DETECTED</span><span className="font-bold text-white">{classification.categoryLabel} · {classification.format}</span></div>
                    {canChooseInput ? (
                      <label className="mt-3 flex items-center justify-between gap-3"><span className="text-white/50">USE WITH</span><select value={uploadTarget} onChange={(event) => setUploadTarget(event.target.value as EnabledWorkflowCreationType)} className="rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white"><option value="">No workflow</option>{allowedTargets.map((target) => <option key={target} value={target}>{workflowLabel(target)}</option>)}</select></label>
                    ) : <p className="mt-3 text-white/45">This file will be stored as a source reference. The current workflows do not accept it directly as input.</p>}
                  </div>
                );
              })()}

              {uploadError && <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-100" role="alert">{uploadError}</div>}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button onClick={closeUpload} className="px-4 py-2 rounded-xl bg-white/5 text-xs font-mono text-white/70">CANCEL</button>
                <button onClick={savePendingUpload} disabled={!pendingUpload || isSavingUpload} className="px-5 py-2.5 rounded-xl bg-white text-black text-xs font-mono font-bold disabled:bg-white/20 disabled:text-white/30">
                  {isSavingUpload ? 'SAVING…' : 'ADD TO LIBRARY'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
