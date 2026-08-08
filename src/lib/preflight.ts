import type { WorkflowCreationType } from '../types';
import { extensionFromName } from './assetUtils';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface SourceValidationInput {
  workflow: WorkflowCreationType;
  sourceImage: string;
  sourceFilename?: string;
  dimensions?: ImageDimensions | null;
}

export function isApproximatelyTwoToOne(width: number, height: number, tolerance = 0.08): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  return Math.abs(width / height - 2) <= tolerance;
}

export function validateWorkflowSource(input: SourceValidationInput): string[] {
  const issues: string[] = [];
  const extension = extensionFromName(input.sourceFilename || input.sourceImage);

  if (!input.sourceImage) {
    issues.push('Choose a source file before starting the workflow.');
    return issues;
  }

  if (input.workflow === 'hdri') {
    issues.push('The HDRI workflow is disabled because no production workflow is connected yet.');
    return issues;
  }

  if (input.workflow === '3d') {
    const allowed = new Set(['hdr', 'exr', 'png', 'jpg', 'jpeg', 'webp']);
    if (extension && !allowed.has(extension)) {
      issues.push('Gaussian Splatting requires an HDR, EXR, PNG, JPG, or WEBP panorama.');
    }
    if (input.dimensions && !isApproximatelyTwoToOne(input.dimensions.width, input.dimensions.height)) {
      issues.push(
        `The panorama must be approximately 2:1 equirectangular. Received ${input.dimensions.width}×${input.dimensions.height}.`,
      );
    }
  }

  if (input.workflow === 'shot' && extension && !['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    issues.push('Cinematic Video requires a PNG, JPG, JPEG, or WEBP continuity frame.');
  }

  if (input.workflow === 'storyboard' && extension && !['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    issues.push('Cinematic Storyboard requires a PNG, JPG, JPEG, or WEBP look reference.');
  }

  if ((input.workflow === 'model' || input.workflow === 'mesh') && extension && !['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    issues.push('3D model workflows require a PNG, JPG, JPEG, or WEBP reference image.');
  }

  return issues;
}

export async function getBrowserImageDimensions(source: string): Promise<ImageDimensions | null> {
  if (!source) return null;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

export function getBrowserCapabilityIssues(workflow: WorkflowCreationType): string[] {
  const issues: string[] = [];
  if (!('fetch' in window)) issues.push('This browser does not support the Fetch API.');
  if (!('AbortController' in window)) issues.push('This browser does not support cancellable workflow requests.');
  if (typeof window.indexedDB === 'undefined') {
    try {
      const key = '__dreamframe_storage_test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
    } catch {
      issues.push('This browser blocks both IndexedDB and localStorage, so the DreamFrame library cannot persist.');
    }
  }

  if (workflow === '3d') {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) issues.push('The Gaussian viewer requires WebGL 2. Enable hardware acceleration or use a newer browser.');
  }

  return issues;
}


export function parseRadianceHdrDimensions(buffer: ArrayBuffer): ImageDimensions | null {
  try {
    const text = new TextDecoder('ascii').decode(buffer.slice(0, Math.min(buffer.byteLength, 64 * 1024)));
    const match = text.match(/(?:^|\n)\s*([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)\s*(?:\n|$)/i);
    if (!match) return null;
    const height = Number(match[2]);
    const width = Number(match[4]);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}

function readNullTerminatedAscii(bytes: Uint8Array, start: number): { value: string; next: number } | null {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  if (end >= bytes.length) return null;
  const value = new TextDecoder('ascii').decode(bytes.slice(start, end));
  return { value, next: end + 1 };
}

export function parseOpenExrDimensions(buffer: ArrayBuffer): ImageDimensions | null {
  try {
    if (buffer.byteLength < 12) return null;
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x762f3101) return null;
    const bytes = new Uint8Array(buffer);
    let offset = 8;

    while (offset < bytes.length) {
      const nameResult = readNullTerminatedAscii(bytes, offset);
      if (!nameResult) return null;
      offset = nameResult.next;
      if (!nameResult.value) return null;

      const typeResult = readNullTerminatedAscii(bytes, offset);
      if (!typeResult) return null;
      offset = typeResult.next;
      if (offset + 4 > bytes.length) return null;
      const size = view.getUint32(offset, true);
      offset += 4;
      if (offset + size > bytes.length) return null;

      if (nameResult.value === 'dataWindow' && typeResult.value === 'box2i' && size >= 16) {
        const xMin = view.getInt32(offset, true);
        const yMin = view.getInt32(offset + 4, true);
        const xMax = view.getInt32(offset + 8, true);
        const yMax = view.getInt32(offset + 12, true);
        const width = xMax - xMin + 1;
        const height = yMax - yMin + 1;
        return width > 0 && height > 0 ? { width, height } : null;
      }
      offset += size;
    }
  } catch {
    return null;
  }
  return null;
}

export async function getSourceImageDimensions(source: string, filename?: string): Promise<ImageDimensions | null> {
  const extension = extensionFromName(filename || source);
  if (extension !== 'hdr' && extension !== 'exr') return getBrowserImageDimensions(source);

  try {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return extension === 'hdr' ? parseRadianceHdrDimensions(buffer) : parseOpenExrDimensions(buffer);
  } catch {
    return null;
  }
}
