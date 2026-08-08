import type { ComfyOutputFile, GenerationResult } from './lib/comfyApi';
import type { PostedGraph } from './lib/workflowGraph';

export type WorkflowCreationType = 'shot' | '3d' | 'model' | 'storyboard' | 'mesh' | 'hdri';
export type EnabledWorkflowCreationType = Exclude<WorkflowCreationType, 'hdri' | 'mesh'>;
export type WorkflowType = 'landing' | 'home' | 'assets' | 'tasks' | 'edit' | WorkflowCreationType;
export type ProjectState = 'idle' | 'processing' | 'completed';

export type Quality3D = 'Draft' | 'Production';
export type OutputMesh = 'Mesh' | 'Point Cloud';
export type AssetPreviewKind = 'image' | 'video' | 'model' | 'gaussian' | 'file';
export type AssetKind = 'source' | 'output';
export type ProjectStatus = 'completed' | 'failed' | 'cancelled';
export type OutputAvailability = 'unknown' | 'available' | 'offline' | 'missing';

export type VideoAspectRatio = '16:9' | '2.39:1 Anamorphic' | '9:16';
export type CameraMotion = 'Dolly In' | 'Orbit' | 'Crane Up' | 'Cinematic Pan' | 'FPV Chase' | 'Locked Off';
export type CinemaLens = '24mm' | '35mm' | '50mm' | '85mm';
export type ShotDuration = 3 | 5;
export type VideoFrameRate = 16 | 24;
export type VideoQualityMode = 'Quality' | 'Fast';
export type MultiShotRenderMode = 'Single PC' | 'Multiple PCs';
export type DistributedShotStatus = 'blocked' | 'ready' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface Workflow3DParams {
  quality: Quality3D;
  gaussianSplatCount: '500K' | '2M' | '5M';
  sphericalHarmonics: boolean;
  depthThreshold: number;
  cameraIntrinsics: 'Auto' | 'Pinhole 35mm' | 'Equirectangular';
}

/** Legacy compatibility for projects generated before Surface Mesh was removed. */
export interface WorkflowMeshParams {
  output: OutputMesh;
  density: 'Standard' | 'Ultra High';
  cleanTopology: boolean;
  poissonDepth: number;
  exportFormat: 'GLTF';
}

export interface WorkflowStoryboardParams {
  shotPrompts: [string, string, string, string];
  styleInfluence: number;
  holdSeconds: 1 | 2 | 3;
  fps: 12 | 24;
  seed: number;
}

export interface MultiShotBeat {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  duration: ShotDuration;
  cameraMotion: CameraMotion;
  focalLength: CinemaLens;
  referenceImage?: string;
  referenceFilename?: string;
  workerId?: string;
}

export interface WorkflowShotParams {
  shots: MultiShotBeat[];
  aspectRatio: VideoAspectRatio;
  fps: VideoFrameRate;
  qualityMode: VideoQualityMode;
  continuityMode: 'Strict' | 'Natural';
  renderMode?: MultiShotRenderMode;
  seed: number;
}

export type ProcessingStatus =
  | 'Running preflight checks'
  | 'Initializing pipeline'
  | 'Extracting continuity frame'
  | 'Rendering shot sequence'
  | 'Reconstructing geometry'
  | 'Optimizing Gaussian splats'
  | 'Rendering final pass';

export interface ProjectItem {
  id: string;
  title: string;
  type: WorkflowCreationType;
  createdAt: string;
  createdAtEpoch?: number;
  status?: ProjectStatus;
  sourceImage?: string;
  sourceFilename?: string;
  sourceBlobKey?: string;
  thumbnailUrl: string;
  previewKind?: AssetPreviewKind;
  downloadUrl?: string;
  downloadFilename?: string;
  outputAvailability?: OutputAvailability;
  outputFiles?: ComfyOutputFile[];
  generationResult?: GenerationResult | null;
  params3d?: Workflow3DParams;
  paramsMesh?: WorkflowMeshParams;
  paramsShot?: WorkflowShotParams;
  paramsStoryboard?: WorkflowStoryboardParams;
  renderDurationMs?: number;
  totalOutputDurationSec?: number;
  errorMessage?: string;
  /** The graphs this project actually posted, captured at dispatch. */
  postedGraphs?: PostedGraph[];
  stats: {
    splatCount?: string;
    polygonCount?: string;
    vertexCount?: string;
    duration?: string;
    resolution?: string;
    filesize?: string;
    renderTime?: string;
  };
}

export interface SampleMedia {
  id: string;
  title: string;
  subtitle: string;
  type: 'panorama' | 'performer';
  url: string;
  previewUrl: string;
}

export interface AssetRecord {
  id: string;
  title: string;
  kind: AssetKind;
  category: WorkflowCreationType | 'texture';
  categoryLabel: string;
  badge: string;
  thumbnailUrl: string;
  previewKind?: AssetPreviewKind;
  fileSize: string;
  fileSizeBytes?: number;
  dimensions: string;
  format: string;
  mimeType?: string;
  uploadedAt: string;
  createdAtEpoch?: number;
  isGenerated?: boolean;
  workflowTarget?: EnabledWorkflowCreationType;
  sourceImage?: string;
  sourceFilename?: string;
  sourceBlobKey?: string;
  blobKey?: string;
  downloadUrl?: string;
  downloadFilename?: string;
  outputAvailability?: OutputAvailability;
  outputFiles?: ComfyOutputFile[];
  generationResult?: GenerationResult | null;
  projectId?: string;
  renderDurationMs?: number;
  totalOutputDurationSec?: number;
  /** Set on an edited asset: the asset this one was made from. Originals are never overwritten. */
  versionOf?: string;
  /** Which edit tool produced it, for the versions list. */
  editOp?: string;
}
