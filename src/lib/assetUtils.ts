import type {
  AssetPreviewKind,
  AssetRecord,
  EnabledWorkflowCreationType,
  WorkflowCreationType,
} from '../types';
import type { ComfyOutputFile } from './comfyApi';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'gif']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff']);
const PANORAMA_EXTENSIONS = new Set(['hdr', 'exr']);
const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'usd', 'usdz']);
const GAUSSIAN_EXTENSIONS = new Set(['ply']);

export interface AssetClassification {
  category: AssetRecord['category'];
  workflowTarget?: EnabledWorkflowCreationType;
  categoryLabel: string;
  previewKind: AssetPreviewKind;
  format: string;
  canUseAsInput: boolean;
}

export interface FileDescriptor {
  name: string;
  type?: string;
}

export function extensionFromName(name: string): string {
  const cleanName = name.split('?')[0].split('#')[0];
  const extension = cleanName.includes('.') ? cleanName.split('.').pop() : '';
  return (extension || '').toLowerCase();
}

export function classifyAssetFile(file: FileDescriptor): AssetClassification {
  const extension = extensionFromName(file.name);
  const mimeType = file.type?.toLowerCase() || '';
  const format = extension ? extension.toUpperCase() : 'FILE';

  if (PANORAMA_EXTENSIONS.has(extension)) {
    return {
      category: '3d',
      workflowTarget: '3d',
      categoryLabel: 'PANORAMA SOURCE',
      previewKind: 'file',
      format,
      canUseAsInput: true,
    };
  }

  if (IMAGE_EXTENSIONS.has(extension) || mimeType.startsWith('image/')) {
    return {
      category: 'model',
      workflowTarget: 'model',
      categoryLabel: 'IMAGE SOURCE',
      previewKind: 'image',
      format: extension ? format : 'IMAGE',
      canUseAsInput: true,
    };
  }

  if (VIDEO_EXTENSIONS.has(extension) || mimeType.startsWith('video/')) {
    return {
      category: 'shot',
      categoryLabel: 'VIDEO SOURCE',
      previewKind: 'video',
      format: extension ? format : 'VIDEO',
      canUseAsInput: false,
    };
  }

  if (GAUSSIAN_EXTENSIONS.has(extension)) {
    const looksGaussian = /gaussian|splat|sharp|merged|rotat/i.test(file.name);
    return {
      category: looksGaussian ? '3d' : 'model',
      categoryLabel: looksGaussian ? 'GAUSSIAN FILE' : '3D FILE SOURCE',
      previewKind: looksGaussian ? 'gaussian' : 'model',
      format,
      canUseAsInput: false,
    };
  }

  if (MODEL_EXTENSIONS.has(extension)) {
    return {
      category: 'model',
      categoryLabel: '3D FILE SOURCE',
      previewKind: 'model',
      format,
      canUseAsInput: false,
    };
  }

  return {
    category: 'texture',
    categoryLabel: 'SOURCE FILE',
    previewKind: 'file',
    format,
    canUseAsInput: false,
  };
}

export function workflowLabel(workflow: WorkflowCreationType): string {
  switch (workflow) {
    case '3d':
      return '3D Gaussian Splatting';
    case 'model':
      return '3D Model Generation';
    case 'mesh':
      return 'Legacy Surface Mesh';
    case 'shot':
      return 'Cinematic Video';
    case 'storyboard':
      return 'Cinematic Storyboard';
    case 'hdri':
      return 'HDRI Environment';
  }
}

export function getPrimaryOutputFile(
  workflow: WorkflowCreationType,
  outputFiles: ComfyOutputFile[],
): ComfyOutputFile | undefined {
  if (workflow === 'shot' || workflow === 'storyboard') {
    return outputFiles.find((file) => VIDEO_EXTENSIONS.has(file.extension));
  }

  if (workflow === 'model' || workflow === 'mesh') {
    return (
      outputFiles.find(
        (file) => MODEL_EXTENSIONS.has(file.extension) && !file.filename.toLowerCase().includes('untextured'),
      ) || outputFiles.find((file) => MODEL_EXTENSIONS.has(file.extension))
    );
  }

  if (workflow === '3d') {
    const plyFiles = outputFiles.filter((file) => file.extension === 'ply');
    return (
      plyFiles.find((file) => /transform|rotat/i.test(file.filename)) ||
      plyFiles.find((file) => /gaussian|merged/i.test(file.filename)) ||
      plyFiles[plyFiles.length - 1]
    );
  }

  return outputFiles[0];
}

export function outputPreviewKind(workflow: WorkflowCreationType): AssetPreviewKind {
  if (workflow === 'shot' || workflow === 'storyboard') return 'video';
  if (workflow === 'model' || workflow === 'mesh') return 'model';
  if (workflow === '3d') return 'gaussian';
  return 'file';
}

export function humanFileSize(bytes?: number): string {
  if (!bytes || bytes < 0) return 'Local file';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function parseHumanFileSize(value: string, fallbackBytes = 0): number {
  if (fallbackBytes > 0) return fallbackBytes;
  const match = value.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const quantity = Number(match[1]);
  const multiplierMap: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return quantity * multiplierMap[match[2].toUpperCase()];
}

export function isGeneratedOutput(asset: AssetRecord): boolean {
  return asset.kind === 'output' || asset.isGenerated === true;
}
