import type { AssetRecord, ProjectItem } from '../types';
import type { GenerationResult } from './comfyApi';

const DATABASE_NAME = 'dreamframe-local-library';
const DATABASE_VERSION = 2;
const STATE_STORE = 'workspace';
const BLOB_STORE = 'blobs';
const STATE_KEY = 'library-v2';
const FALLBACK_KEY = 'dreamframe-library-v2';
const LEGACY_STATE_KEY = 'library-v1';
const LEGACY_FALLBACK_KEY = 'dreamframe-library-v1';

export interface LibraryState {
  version: 2;
  assets: AssetRecord[];
  projects: ProjectItem[];
  savedAt: number;
}

export function migrateLegacyLibraryState(raw: unknown): LibraryState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { assets?: unknown; projects?: unknown; savedAt?: unknown };
  if (!Array.isArray(candidate.assets) || !Array.isArray(candidate.projects)) return null;

  const now = Date.now();
  const assets = candidate.assets.map((value, index) => {
    const asset = value as Partial<AssetRecord> & { isGenerated?: boolean };
    const createdAtEpoch = Number(asset.createdAtEpoch) || now - index;
    const kind = asset.kind || (asset.isGenerated ? 'output' : 'source');
    return {
      id: asset.id || `migrated-asset-${createdAtEpoch}-${index}`,
      title: asset.title || 'Migrated Asset',
      kind,
      category: asset.category || 'model',
      categoryLabel: asset.categoryLabel || (kind === 'output' ? 'MIGRATED OUTPUT' : 'MIGRATED SOURCE'),
      badge: asset.badge || (kind === 'output' ? 'OUTPUT' : 'SOURCE'),
      thumbnailUrl: asset.thumbnailUrl || '',
      previewKind: asset.previewKind || 'image',
      fileSize: asset.fileSize || 'Unknown size',
      fileSizeBytes: asset.fileSizeBytes,
      dimensions: asset.dimensions || 'Migrated library item',
      format: asset.format || 'FILE',
      mimeType: asset.mimeType,
      uploadedAt: asset.uploadedAt || new Date(createdAtEpoch).toLocaleString(),
      createdAtEpoch,
      isGenerated: kind === 'output',
      workflowTarget: asset.workflowTarget,
      sourceImage: asset.sourceImage,
      sourceFilename: asset.sourceFilename,
      sourceBlobKey: asset.sourceBlobKey,
      blobKey: asset.blobKey,
      downloadUrl: asset.downloadUrl,
      downloadFilename: asset.downloadFilename,
      outputAvailability: asset.outputAvailability || (kind === 'output' ? 'unknown' : undefined),
      outputFiles: asset.outputFiles,
      generationResult: asset.generationResult,
      projectId: asset.projectId,
      renderDurationMs: asset.renderDurationMs,
      totalOutputDurationSec: asset.totalOutputDurationSec,
    } satisfies AssetRecord;
  });

  const projects = candidate.projects.map((value, index) => {
    const project = value as Partial<ProjectItem>;
    const createdAtEpoch = Number(project.createdAtEpoch) || now - index;
    return {
      id: project.id || `migrated-project-${createdAtEpoch}-${index}`,
      title: project.title || 'Migrated Project',
      type: project.type || 'model',
      createdAt: project.createdAt || new Date(createdAtEpoch).toLocaleString(),
      createdAtEpoch,
      status: project.status || (project.downloadUrl ? 'completed' : 'failed'),
      sourceImage: project.sourceImage,
      sourceFilename: project.sourceFilename,
      sourceBlobKey: project.sourceBlobKey,
      thumbnailUrl: project.thumbnailUrl || project.sourceImage || '',
      previewKind: project.previewKind || 'image',
      downloadUrl: project.downloadUrl,
      downloadFilename: project.downloadFilename,
      outputAvailability: project.outputAvailability || (project.downloadUrl ? 'unknown' : 'missing'),
      outputFiles: project.outputFiles,
      generationResult: project.generationResult,
      params3d: project.params3d,
      paramsMesh: project.paramsMesh,
      paramsShot: project.paramsShot,
      paramsStoryboard: project.paramsStoryboard,
      renderDurationMs: project.renderDurationMs,
      totalOutputDurationSec: project.totalOutputDurationSec,
      errorMessage: project.errorMessage,
      stats: project.stats || {},
    } satisfies ProjectItem;
  });

  return {
    version: 2,
    assets,
    projects,
    savedAt: Number(candidate.savedAt) || now,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(BLOB_STORE)) database.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the DreamFrame library database.'));
  });
}

function sanitizeGenerationResult(result?: GenerationResult | null): GenerationResult | null | undefined {
  if (result === undefined) return undefined;
  if (result === null) return null;
  return {
    promptId: result.promptId,
    outputFiles: result.outputFiles,
    warning: result.warning,
    history: {},
    shotResults: result.shotResults,
    renderDurationMs: result.renderDurationMs,
    totalOutputDurationSec: result.totalOutputDurationSec,
  };
}

function sanitizeAsset(asset: AssetRecord): AssetRecord {
  const copy: AssetRecord = {
    ...asset,
    generationResult: sanitizeGenerationResult(asset.generationResult),
    outputFiles: asset.outputFiles?.map((file) => ({ ...file })),
  };
  if (copy.blobKey) {
    copy.sourceImage = undefined;
    copy.downloadUrl = undefined;
    if (copy.kind === 'output') {
      copy.outputFiles = copy.outputFiles?.map((file) => ({ ...file, url: '' }));
      if (copy.generationResult) {
        copy.generationResult = {
          ...copy.generationResult,
          outputFiles: copy.generationResult.outputFiles.map((file) => ({ ...file, url: '' })),
        };
      }
    }
  } else if (copy.sourceBlobKey) {
    copy.sourceImage = undefined;
  }
  return copy;
}

function sanitizeProject(project: ProjectItem): ProjectItem {
  const copy: ProjectItem = {
    ...project,
    generationResult: sanitizeGenerationResult(project.generationResult),
    outputFiles: project.outputFiles?.map((file) => ({ ...file })),
  };
  if (copy.sourceBlobKey) copy.sourceImage = undefined;
  return copy;
}

function serializeFallback(state: LibraryState): boolean {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function readFallback(): LibraryState | null {
  try {
    const currentRaw = localStorage.getItem(FALLBACK_KEY);
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw) as LibraryState;
      if (parsed?.version === 2 && Array.isArray(parsed.assets) && Array.isArray(parsed.projects)) return parsed;
    }

    const legacyRaw = localStorage.getItem(LEGACY_FALLBACK_KEY);
    if (!legacyRaw) return null;
    return migrateLegacyLibraryState(JSON.parse(legacyRaw));
  } catch {
    return null;
  }
}

async function readBlob(database: IDBDatabase, key: string): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BLOB_STORE, 'readonly');
    const request = transaction.objectStore(BLOB_STORE).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error || new Error('Could not read a stored asset file.'));
  });
}

async function hydrateState(state: LibraryState): Promise<LibraryState> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const assets = await Promise.all(state.assets.map(async (asset) => {
      const key = asset.blobKey || asset.sourceBlobKey;
      if (!key) return asset;
      const blob = await readBlob(database as IDBDatabase, key);
      if (!blob) return asset.blobKey ? { ...asset, outputAvailability: 'missing' as const } : asset;
      const url = URL.createObjectURL(blob);
      if (!asset.blobKey) return { ...asset, sourceImage: url };

      if (asset.kind === 'output') {
        const outputFiles = asset.outputFiles?.length
          ? asset.outputFiles.map((file) => ({ ...file, url }))
          : asset.downloadFilename
            ? [{ filename: asset.downloadFilename, subfolder: '', type: 'output' as const, extension: asset.format.toLowerCase(), url }]
            : [];
        const generationResult = asset.generationResult
          ? { ...asset.generationResult, outputFiles }
          : asset.generationResult;
        return {
          ...asset,
          sourceImage: url,
          downloadUrl: url,
          outputFiles,
          generationResult,
          outputAvailability: 'available' as const,
        };
      }

      return { ...asset, sourceImage: url, downloadUrl: url };
    }));
    const hydratedProjects = await Promise.all(state.projects.map(async (project) => {
      if (!project.sourceBlobKey) return project;
      const blob = await readBlob(database as IDBDatabase, project.sourceBlobKey);
      return blob ? { ...project, sourceImage: URL.createObjectURL(blob) } : project;
    }));
    const projects = hydratedProjects.map((project) => {
      const linkedOutput = assets.find((asset) => asset.projectId === project.id && asset.kind === 'output' && asset.blobKey);
      if (!linkedOutput) return project;
      return {
        ...project,
        downloadUrl: linkedOutput.downloadUrl,
        downloadFilename: linkedOutput.downloadFilename,
        outputFiles: linkedOutput.outputFiles,
        generationResult: linkedOutput.generationResult,
        outputAvailability: linkedOutput.outputAvailability,
        status: linkedOutput.downloadUrl ? 'completed' as const : project.status,
      };
    });
    return { ...state, assets, projects };
  } finally {
    database?.close();
  }
}

export async function saveAssetBlob(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BLOB_STORE, 'readwrite');
      transaction.objectStore(BLOB_STORE).put(blob, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not store the asset file.'));
    });
  } finally {
    database.close();
  }
}

export async function deleteAssetBlob(key?: string): Promise<void> {
  if (!key) return;
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BLOB_STORE, 'readwrite');
      transaction.objectStore(BLOB_STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not delete the stored asset file.'));
    });
  } finally {
    database.close();
  }
}

export async function saveLibraryState(assets: AssetRecord[], projects: ProjectItem[]): Promise<void> {
  const state: LibraryState = {
    version: 2,
    assets: assets.map(sanitizeAsset),
    projects: projects.map(sanitizeProject),
    savedAt: Date.now(),
  };
  const fallbackSaved = serializeFallback(state);
  let database: IDBDatabase;
  try {
    database = await openDatabase();
  } catch (error) {
    if (fallbackSaved) return;
    throw error;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      transaction.objectStore(STATE_STORE).put(state, STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the DreamFrame library.'));
      transaction.onabort = () => reject(transaction.error || new Error('Saving the DreamFrame library was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function loadLibraryState(): Promise<LibraryState | null> {
  try {
    const database = await openDatabase();
    try {
      const state = await new Promise<LibraryState | null>((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE, 'readonly');
        const store = transaction.objectStore(STATE_STORE);
        const currentRequest = store.get(STATE_KEY);
        currentRequest.onerror = () => reject(currentRequest.error || new Error('Could not read the DreamFrame library.'));
        currentRequest.onsuccess = () => {
          const current = currentRequest.result as LibraryState | undefined;
          if (current?.version === 2) {
            resolve(current);
            return;
          }
          const legacyRequest = store.get(LEGACY_STATE_KEY);
          legacyRequest.onerror = () => reject(legacyRequest.error || new Error('Could not read the legacy DreamFrame library.'));
          legacyRequest.onsuccess = () => resolve(migrateLegacyLibraryState(legacyRequest.result));
        };
      });
      if (state?.version === 2) return hydrateState(state);
    } finally {
      database.close();
    }
  } catch {
    // Fall back to metadata-only localStorage when IndexedDB is unavailable.
  }
  const fallback = readFallback();
  return fallback ? hydrateState(fallback).catch(() => fallback) : null;
}

export async function clearLibraryState(): Promise<void> {
  localStorage.removeItem(FALLBACK_KEY);
  localStorage.removeItem(LEGACY_FALLBACK_KEY);
  try {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([STATE_STORE, BLOB_STORE], 'readwrite');
        transaction.objectStore(STATE_STORE).clear();
        transaction.objectStore(BLOB_STORE).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not clear the DreamFrame library.'));
      });
    } finally {
      database.close();
    }
  } catch {
    // localStorage has already been cleared.
  }
}
