import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  AssetRecord,
  ProjectItem,
  ProjectState,
  Workflow3DParams,
  WorkflowCreationType,
  WorkflowMeshParams,
  WorkflowShotParams,
  WorkflowStoryboardParams,
  WorkflowType,
} from './types';
import { INITIAL_ASSETS, INITIAL_PROJECTS } from './data/samples';
import { Header } from './components/Header';
import { LandingScreen } from './components/LandingScreen';
import { HomeScreen } from './components/HomeScreen';
import { WorkflowPanel } from './components/WorkflowPanel';
import { ProcessingView } from './components/ProcessingView';
import { CompletedView } from './components/CompletedView';
import { ProjectsDrawer } from './components/ProjectsDrawer';
import { AssetsView } from './components/AssetsView';
import { TasksView } from './components/TasksView';
import { TasksDock } from './components/TasksDock';
import { EditView } from './components/EditView';
import {
  DistributedShotUpdate,
  GenerationProgress,
  GenerationResult,
  checkOutputAvailability,
  interruptComfy,
  runSharpGaussianWorkflow,
  runStoryboardWorkflow,
  runTrellisWorkflow,
  runWanDistributedMultiShotWorkflow,
  runWanMultiShotWorkflow,
  runWorkflowPreflight,
} from './lib/comfyApi';
import { getPrimaryOutputFile, outputPreviewKind } from './lib/assetUtils';
import { deleteAssetBlob, loadLibraryState, saveAssetBlob, saveLibraryState } from './lib/storage';
import { loadAndInspectRenderWorkers, RenderWorker } from './lib/renderWorkers';
import type { PostedGraph } from './lib/workflowGraph';

const ENABLED_WORKFLOWS = new Set<WorkflowCreationType>(['3d', 'model', 'shot', 'storyboard']);

async function checkRecordAvailability(downloadUrl?: string, outputFiles?: GenerationResult['outputFiles']) {
  const urls = Array.from(new Set((outputFiles || []).filter((file) => file.type === 'output').map((file) => file.url).filter(Boolean)));
  if (urls.length === 0 && downloadUrl) urls.push(downloadUrl);
  if (urls.length === 0) return 'missing' as const;

  const statuses = await Promise.all(urls.map((url) => checkOutputAvailability(url)));
  if (statuses.some((status) => status === 'offline')) return 'offline' as const;
  if (statuses.some((status) => status === 'missing')) return 'missing' as const;
  if (statuses.every((status) => status === 'available')) return 'available' as const;
  return 'unknown' as const;
}

function formatRenderDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}


async function persistSourcePreview(sourceImage: string, storageKey: string): Promise<{ sourceBlobKey?: string; thumbnailUrl: string }> {
  if (!sourceImage) return { thumbnailUrl: '' };
  try {
    const response = await fetch(sourceImage);
    const blob = await response.blob();
    await saveAssetBlob(storageKey, blob);
    if (!blob.type.startsWith('image/') || /(?:exr|hdr)$/i.test(blob.type)) {
      return { sourceBlobKey: storageKey, thumbnailUrl: '' };
    }
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Thumbnail canvas unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return { sourceBlobKey: storageKey, thumbnailUrl: canvas.toDataURL('image/jpeg', 0.76) };
  } catch {
    return { thumbnailUrl: sourceImage };
  }
}

function createProjectFromAsset(asset: AssetRecord): ProjectItem {
  const target = asset.workflowTarget || (asset.category === 'texture' ? 'model' : asset.category);
  return {
    id: asset.projectId || `asset-project-${asset.id}`,
    title: asset.title,
    type: target,
    createdAt: asset.uploadedAt,
    createdAtEpoch: asset.createdAtEpoch,
    status: asset.downloadUrl ? 'completed' : 'failed',
    sourceImage: asset.sourceImage,
    sourceFilename: asset.sourceFilename,
    thumbnailUrl: asset.thumbnailUrl,
    previewKind: asset.previewKind,
    downloadUrl: asset.downloadUrl,
    downloadFilename: asset.downloadFilename,
    outputFiles: asset.outputFiles,
    generationResult: asset.generationResult ?? null,
    stats: {
      duration: asset.category === 'shot' || asset.category === 'storyboard' ? asset.dimensions : undefined,
      polygonCount: asset.category === 'mesh' || asset.category === 'model' ? asset.dimensions : undefined,
      resolution: asset.category === '3d' ? asset.dimensions : undefined,
      filesize: asset.fileSize,
    },
  };
}

export default function App() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowType>('landing');
  const [projectState, setProjectState] = useState<ProjectState>('idle');
  const [currentImage, setCurrentImage] = useState('');
  const [projects, setProjects] = useState<ProjectItem[]>(INITIAL_PROJECTS);
  const [assets, setAssets] = useState<AssetRecord[]>(INITIAL_ASSETS);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<ProjectItem | null>(null);
  const [selectedSourceAsset, setSelectedSourceAsset] = useState<AssetRecord | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>({ percent: 0, status: 'Ready' });
  const [generationError, setGenerationError] = useState('');
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [manualShotControl, setManualShotControl] = useState<{ currentIndex: number; totalShots: number; title: string } | null>(null);
  const [distributedShotControls, setDistributedShotControls] = useState<DistributedShotUpdate[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'saved' | 'error'>('loading');
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationPromptIdRef = useRef<string | null>(null);
  const availabilityCheckedRef = useRef(false);
  const generationStartedAtRef = useRef<number | null>(null);
  const generationGraphsRef = useRef<PostedGraph[]>([]);
  const manualShotResolverRef = useRef<(() => void) | null>(null);
  const distributedShotResolversRef = useRef(new Map<number, { resolve: () => void; reject: (error?: unknown) => void; cleanup: () => void }>());
  const distributedShotAbortControllersRef = useRef(new Map<number, AbortController>());
  const distributedShotPromptsRef = useRef(new Map<number, { promptId: string; worker: RenderWorker }>());
  const generationContextRef = useRef<{
    workflow: WorkflowCreationType;
    sourceImage: string;
    sourceFilename?: string;
    params3d?: Workflow3DParams;
    paramsMesh?: WorkflowMeshParams;
    paramsShot?: WorkflowShotParams;
    paramsStoryboard?: WorkflowStoryboardParams;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void loadLibraryState()
      .then((state) => {
        if (!active) return;
        if (state) {
          setAssets(state.assets);
          setProjects(state.projects);
        }
        setLibraryReady(true);
        setLibraryStatus('saved');
      })
      .catch(() => {
        if (!active) return;
        setLibraryReady(true);
        setLibraryStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!libraryReady || availabilityCheckedRef.current) return;
    availabilityCheckedRef.current = true;
    const refresh = async () => {
      const assetStatuses = await Promise.all(assets.map(async (asset) => ({
        id: asset.id,
        status: asset.kind === 'output' ? await checkRecordAvailability(asset.downloadUrl, asset.outputFiles) : 'unknown' as const,
      })));
      const projectStatuses = await Promise.all(projects.map(async (project) => ({
        id: project.id,
        status: await checkRecordAvailability(project.downloadUrl, project.outputFiles),
      })));
      setAssets((previous) => previous.map((asset) => {
        if (asset.kind !== 'output') return asset;
        const match = assetStatuses.find((item) => item.id === asset.id);
        return match ? { ...asset, outputAvailability: match.status } : asset;
      }));
      setProjects((previous) => previous.map((project) => {
        const match = projectStatuses.find((item) => item.id === project.id);
        return match ? { ...project, outputAvailability: match.status } : project;
      }));
    };
    void refresh();
  }, [libraryReady]);

  useEffect(() => {
    if (!libraryReady) return;
    setLibraryStatus('loading');
    const timeout = window.setTimeout(() => {
      void saveLibraryState(assets, projects)
        .then(() => setLibraryStatus('saved'))
        .catch(() => setLibraryStatus('error'));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [assets, projects, libraryReady]);

  const resetTransientState = () => {
    setSelectedSourceAsset(null);
    setActiveProject(null);
    setGenerationResult(null);
    setGenerationError('');
    setManualShotControl(null);
    manualShotResolverRef.current = null;
    setDistributedShotControls([]);
    distributedShotResolversRef.current.clear();
    distributedShotAbortControllersRef.current.clear();
    distributedShotPromptsRef.current.clear();
  };

  const openWorkflow = (workflow: WorkflowCreationType) => {
    if (!ENABLED_WORKFLOWS.has(workflow)) return;
    resetTransientState();
    setActiveWorkflow(workflow);
    setProjectState('idle');
  };

  const handleProceed = (targetWorkflow?: WorkflowCreationType) => {
    if (targetWorkflow) openWorkflow(targetWorkflow);
    else {
      resetTransientState();
      setActiveWorkflow('home');
      setProjectState('idle');
    }
  };

  const handleGoHome = () => {
    resetTransientState();
    setActiveWorkflow('home');
    setProjectState('idle');
  };

  const handleGoLanding = () => {
    resetTransientState();
    setActiveWorkflow('landing');
    setProjectState('idle');
  };

  const handleGoAssets = () => {
    setActiveWorkflow('assets');
    setProjectState('idle');
  };

  const handleGoEdit = () => {
    setActiveWorkflow('edit');
    setProjectState('idle');
  };

  const handleGoTasks = () => {
    setActiveWorkflow('tasks');
    setProjectState('idle');
  };

  const handleViewOutputAsset = (asset: AssetRecord) => {
    if (asset.kind !== 'output') return;
    const linkedProject = asset.projectId ? projects.find((project) => project.id === asset.projectId) : undefined;
    const project = linkedProject || createProjectFromAsset(asset);
    resetTransientState();
    setGenerationResult(asset.generationResult ?? project.generationResult ?? null);
    setActiveProject(project);
    setCurrentImage(asset.sourceImage || asset.thumbnailUrl);
    setActiveWorkflow(project.type);
    setProjectState('completed');
  };

  const handleUseSourceAsset = (asset: AssetRecord) => {
    if (asset.kind !== 'source' || !asset.workflowTarget) return;
    resetTransientState();
    setSelectedSourceAsset(asset);
    setCurrentImage(asset.sourceImage || asset.thumbnailUrl);
    setActiveWorkflow(asset.workflowTarget);
    setProjectState('idle');
  };

  const handleRunCurrentShot = () => {
    const resolver = manualShotResolverRef.current;
    if (!resolver || !manualShotControl) return;
    setGenerationProgress((previous) => ({ ...previous, status: `Starting shot ${manualShotControl.currentIndex + 1} of ${manualShotControl.totalShots}: ${manualShotControl.title}` }));
    manualShotResolverRef.current = null;
    setManualShotControl(null);
    resolver();
  };

  const handleRunDistributedShot = (index: number) => {
    const pending = distributedShotResolversRef.current.get(index);
    if (!pending) return;
    pending.cleanup();
    distributedShotResolversRef.current.delete(index);
    pending.resolve();
  };

  const handleRunAllReadyShots = () => {
    distributedShotControls
      .filter((shot) => shot.status === 'ready')
      .forEach((shot) => handleRunDistributedShot(shot.index));
  };

  const handleCancelDistributedShot = async (index: number) => {
    distributedShotAbortControllersRef.current.get(index)?.abort();
    const prompt = distributedShotPromptsRef.current.get(index);
    if (prompt) await interruptComfy(prompt.promptId, prompt.worker.apiBase);
    setDistributedShotControls((previous) => previous.map((shot) => shot.index === index ? {
      ...shot,
      status: 'cancelled',
      percent: 0,
      message: `Shot ${index + 1} was cancelled by the artist.`,
    } : shot));
  };

  const handleStartGeneration = async (params: {
    sourceImage: string;
    sourceFilename?: string;
    params3d?: Workflow3DParams;
    paramsMesh?: WorkflowMeshParams;
    paramsShot?: WorkflowShotParams;
    paramsStoryboard?: WorkflowStoryboardParams;
  }, workflowOverride?: WorkflowCreationType) => {
    const workflow = workflowOverride || (activeWorkflow as WorkflowCreationType);
    if (!ENABLED_WORKFLOWS.has(workflow)) {
      setGenerationError('This workflow is not connected yet.');
      return;
    }

    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationPromptIdRef.current = null;
    setManualShotControl(null);
    manualShotResolverRef.current = null;
    setDistributedShotControls([]);
    distributedShotResolversRef.current.clear();
    distributedShotAbortControllersRef.current.clear();
    distributedShotPromptsRef.current.clear();
    generationStartedAtRef.current = performance.now();
    generationGraphsRef.current = [];
    generationContextRef.current = { workflow, ...params };

    setCurrentImage(params.sourceImage);
    setSelectedSourceAsset(null);
    setGenerationError('');
    setGenerationResult(null);
    setActiveProject(null);
    setGenerationProgress({ percent: 1, status: 'Running preflight checks' });
    setProjectState('processing');

    try {
      const isDistributedShot = workflow === 'shot' && params.paramsShot?.renderMode === 'Multiple PCs';

      if (!isDistributedShot) {
        await runWorkflowPreflight({
          workflow,
          sourceImage: params.sourceImage,
          sourceFilename: params.sourceFilename,
          signal: controller.signal,
          onProgress: setGenerationProgress,
        });
      }

      const collectGraph: NonNullable<Parameters<typeof runStoryboardWorkflow>[0]['onGraph']> = (graph, meta) => {
        generationGraphsRef.current = [
          ...generationGraphsRef.current.filter((item) => item.promptId !== meta.promptId),
          { ...meta, graph },
        ].sort((a, b) => (a.shotIndex ?? 0) - (b.shotIndex ?? 0));
      };

      const workflowTitles: Record<WorkflowCreationType, string> = {
        shot: 'Shot Editor sequence',
        storyboard: 'Storyboard animatic',
        model: '3D model',
        '3d': 'Gaussian splat scene',
        mesh: 'Surface mesh',
        hdri: 'HDRI environment',
      };

      const sharedOptions = {
        sourceImage: params.sourceImage,
        sourceFilename: params.sourceFilename,
        signal: controller.signal,
        onProgress: setGenerationProgress,
        onPromptId: (promptId: string) => {
          generationPromptIdRef.current = promptId;
        },
        preflightPassed: true,
        tag: { workflow, title: workflowTitles[workflow] },
        onGraph: collectGraph,
      };

      let result: GenerationResult;
      if (workflow === 'shot') {
        const shotParams = params.paramsShot;
        const shots = shotParams?.shots ?? [];
        if (isDistributedShot) {
          setGenerationProgress({ percent: 2, status: 'Connecting to render PCs' });
          const workerResponse = await loadAndInspectRenderWorkers(controller.signal);
          const onlineWorkers = workerResponse.workers.filter((worker) => worker.status === 'online');
          if (onlineWorkers.length < 2) {
            throw new Error(`Multi-PC rendering needs at least two online ComfyUI machines. Update ${workerResponse.configFile || 'dreamframe-workers.json'}, start ComfyUI on each PC with LAN access, and try again.`);
          }

          distributedShotAbortControllersRef.current = new Map(
            shots.map((_, index): [number, AbortController] => [index, new AbortController()]),
          );
          setDistributedShotControls(shots.map((shot, index): DistributedShotUpdate => {
            const worker = onlineWorkers.find((candidate) => candidate.id === shot.workerId) || onlineWorkers[index % onlineWorkers.length];
            return {
              index,
              title: shot.title,
              workerId: worker.id,
              workerName: worker.name,
              status: index > 0 && !shot.referenceImage ? 'blocked' : 'ready',
              percent: 0,
              message: index > 0 && !shot.referenceImage ? `Waiting for shot ${index}` : `Ready on ${worker.name}`,
            };
          }));

          result = await runWanDistributedMultiShotWorkflow({
            sourceImage: params.sourceImage,
            sourceFilename: params.sourceFilename,
            signal: controller.signal,
            onProgress: setGenerationProgress,
            tag: { workflow, title: workflowTitles[workflow] },
            onGraph: collectGraph,
            shots,
            workers: onlineWorkers,
            aspectRatio: shotParams?.aspectRatio ?? '16:9',
            fps: shotParams?.fps ?? 24,
            qualityMode: shotParams?.qualityMode ?? 'Quality',
            continuityMode: shotParams?.continuityMode ?? 'Strict',
            seed: shotParams?.seed,
            onShotUpdate: (update) => {
              setDistributedShotControls((previous) => {
                const exists = previous.some((item) => item.index === update.index);
                const next = exists
                  ? previous.map((item) => item.index === update.index ? update : item)
                  : [...previous, update];
                return [...next].sort((a, b) => a.index - b.index);
              });
            },
            onShotPromptId: (index, promptId, worker) => {
              distributedShotPromptsRef.current.set(index, { promptId, worker });
            },
            getShotSignal: (index) => distributedShotAbortControllersRef.current.get(index)?.signal,
            onAwaitShotStart: ({ index }) => new Promise<void>((resolve, reject) => {
              const shotController = distributedShotAbortControllersRef.current.get(index);
              if (controller.signal.aborted || shotController?.signal.aborted) {
                reject(new DOMException('Shot cancelled', 'AbortError'));
                return;
              }
              const handleAbort = () => {
                const pending = distributedShotResolversRef.current.get(index);
                pending?.cleanup();
                distributedShotResolversRef.current.delete(index);
                reject(new DOMException('Shot cancelled', 'AbortError'));
              };
              const cleanup = () => {
                controller.signal.removeEventListener('abort', handleAbort);
                shotController?.signal.removeEventListener('abort', handleAbort);
              };
              distributedShotResolversRef.current.set(index, { resolve, reject, cleanup });
              controller.signal.addEventListener('abort', handleAbort, { once: true });
              shotController?.signal.addEventListener('abort', handleAbort, { once: true });
            }),
          });
        } else {
          result = await runWanMultiShotWorkflow({
            ...sharedOptions,
            shots,
            aspectRatio: shotParams?.aspectRatio ?? '16:9',
            fps: shotParams?.fps ?? 24,
            qualityMode: shotParams?.qualityMode ?? 'Quality',
            continuityMode: shotParams?.continuityMode ?? 'Strict',
            seed: shotParams?.seed,
            onAwaitShotStart: ({ index, totalShots, shot }) => new Promise<void>((resolve, reject) => {
              if (controller.signal.aborted) {
                reject(new DOMException('Generation cancelled', 'AbortError'));
                return;
              }
              setManualShotControl({ currentIndex: index, totalShots, title: shot.title });
              setGenerationProgress((previous) => ({
                ...previous,
                percent: Math.max(previous.percent, Math.round(10 + (index / Math.max(1, totalShots)) * 85)),
                status: `Ready to run shot ${index + 1} of ${totalShots}: ${shot.title}`,
              }));
              const handleAbort = () => {
                manualShotResolverRef.current = null;
                setManualShotControl(null);
                reject(new DOMException('Generation cancelled', 'AbortError'));
              };
              manualShotResolverRef.current = () => {
                controller.signal.removeEventListener('abort', handleAbort);
                resolve();
              };
              controller.signal.addEventListener('abort', handleAbort, { once: true });
            }),
          });
        }
      } else if (workflow === 'storyboard') {
        result = await runStoryboardWorkflow({
          ...sharedOptions,
          shotPrompts: params.paramsStoryboard?.shotPrompts ?? ['', '', '', ''],
          styleInfluence: params.paramsStoryboard?.styleInfluence ?? 0.65,
          holdSeconds: params.paramsStoryboard?.holdSeconds ?? 2,
          fps: params.paramsStoryboard?.fps ?? 12,
          seed: params.paramsStoryboard?.seed,
        });
      } else if (workflow === '3d') {
        result = await runSharpGaussianWorkflow(sharedOptions);
      } else {
        result = await runTrellisWorkflow({
          ...sharedOptions,
          density: params.paramsMesh?.density ?? 'Ultra High',
          lowVram: true,
        });
      }

      const renderDurationMs = result.renderDurationMs ?? Math.max(0, Math.round(performance.now() - (generationStartedAtRef.current ?? performance.now())));
      const timedResult = { ...result, renderDurationMs };
      setGenerationResult(timedResult);
      await handleCompleteGeneration(workflow, timedResult, params.sourceImage, params.sourceFilename, params.paramsShot, params.paramsStoryboard, params.paramsMesh, params.params3d);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setProjectState('idle');
        return;
      }
      const message = error instanceof Error ? error.message : 'The local workflow failed.';
      setGenerationError(message);
      setManualShotControl(null);
      manualShotResolverRef.current = null;
      setDistributedShotControls([]);
      await recordInterruptedProject('failed', message);
    } finally {
      generationAbortRef.current = null;
      generationPromptIdRef.current = null;
      setManualShotControl(null);
      manualShotResolverRef.current = null;
      distributedShotResolversRef.current.forEach((pending) => pending.cleanup());
      distributedShotResolversRef.current.clear();
      distributedShotAbortControllersRef.current.clear();
      distributedShotPromptsRef.current.clear();
      generationStartedAtRef.current = null;
      generationContextRef.current = null;
    }
  };

  const handleCancelGeneration = async () => {
    const promptId = generationPromptIdRef.current;
    generationAbortRef.current?.abort();
    distributedShotAbortControllersRef.current.forEach((controller) => controller.abort());
    setManualShotControl(null);
    manualShotResolverRef.current = null;
    setGenerationProgress((previous) => ({ ...previous, status: 'Cancelling render…' }));
    const cancellationRecord = recordInterruptedProject('cancelled', 'The render was cancelled by the artist.');
    const distributedInterrupts = [...distributedShotPromptsRef.current.values()].map(({ promptId: shotPromptId, worker }) => interruptComfy(shotPromptId, worker.apiBase));
    await Promise.allSettled([
      interruptComfy(promptId ?? undefined),
      ...distributedInterrupts,
    ]);
    await cancellationRecord;
    setGenerationError('');
    setGenerationProgress({ percent: 0, status: 'Cancelled' });
    setDistributedShotControls([]);
    setProjectState('idle');
  };

  const recordInterruptedProject = async (status: 'failed' | 'cancelled', errorMessage: string) => {
    const context = generationContextRef.current;
    if (!context) return;
    const now = Date.now();
    const elapsed = Math.max(0, Math.round(performance.now() - (generationStartedAtRef.current ?? performance.now())));
    const title = status === 'cancelled' ? 'Cancelled Render' : 'Failed Render';
    const projectId = `project-${status}-${now}`;
    const sourcePreview = await persistSourcePreview(context.sourceImage, `project-source-${projectId}`);
    const project: ProjectItem = {
      id: projectId,
      title,
      type: context.workflow,
      createdAt: new Date(now).toLocaleString(),
      createdAtEpoch: now,
      status,
      sourceImage: context.sourceImage,
      sourceFilename: context.sourceFilename,
      sourceBlobKey: sourcePreview.sourceBlobKey,
      thumbnailUrl: sourcePreview.thumbnailUrl || context.sourceImage,
      previewKind: outputPreviewKind(context.workflow),
      paramsShot: context.paramsShot,
      paramsStoryboard: context.paramsStoryboard,
      paramsMesh: context.paramsMesh,
      params3d: context.params3d,
      renderDurationMs: elapsed,
      errorMessage,
      postedGraphs: generationGraphsRef.current,
      outputAvailability: 'missing',
      stats: {
        duration: context.paramsShot ? `${context.paramsShot.shots.length} shots · ${context.paramsShot.shots.reduce((sum, shot) => sum + shot.duration, 0)} sec` : undefined,
        renderTime: formatRenderDuration(elapsed),
        filesize: status === 'cancelled' ? 'Cancelled' : 'Failed',
      },
    };
    setProjects((previous) => [project, ...previous]);
  };

  const handleCompleteGeneration = async (
    workflow: WorkflowCreationType,
    result: GenerationResult,
    sourceImage: string,
    sourceFilename?: string,
    shotParams?: WorkflowShotParams,
    storyboardParams?: WorkflowStoryboardParams,
    meshParams?: WorkflowMeshParams,
    params3d?: Workflow3DParams,
  ) => {
    const now = Date.now();
    const primaryOutput = getPrimaryOutputFile(workflow, result.outputFiles);
    const outputMissing = !primaryOutput;
    const titleMap: Record<WorkflowCreationType, string> = {
      '3d': 'Gaussian Splat Environment',
      model: 'TRELLIS.2 3D Model',
      mesh: 'TRELLIS.2 Surface Mesh',
      storyboard: 'Cinematic Storyboard Animatic',
      shot: 'Cinematic Shot Editor Sequence',
      hdri: 'HDRI Environment',
    };
    const labelMap: Record<WorkflowCreationType, string> = {
      '3d': 'GAUSSIAN SPLAT OUTPUT',
      model: '3D MODEL OUTPUT',
      mesh: 'SURFACE MESH OUTPUT',
      storyboard: 'STORYBOARD OUTPUT',
      shot: 'SHOT EDITOR VIDEO OUTPUT',
      hdri: 'HDRI OUTPUT',
    };
    const title = titleMap[workflow];
    const projectId = `project-${now}`;
    const sourceStorageKey = `project-source-${projectId}`;
    const sourcePreview = await persistSourcePreview(sourceImage, sourceStorageKey);
    const createdAt = new Date(now).toLocaleString();
    const totalOutputDurationSec = workflow === 'shot'
      ? result.totalOutputDurationSec ?? shotParams?.shots.reduce((sum, shot) => sum + shot.duration, 0) ?? 0
      : workflow === 'storyboard'
        ? result.totalOutputDurationSec ?? (storyboardParams?.holdSeconds ?? 2) * 4
        : 0;
    const duration = workflow === 'shot'
      ? `${shotParams?.shots.length ?? result.shotResults?.length ?? 0} shots · ${totalOutputDurationSec} sec · ${shotParams?.fps ?? 24} FPS`
      : workflow === 'storyboard'
        ? `${totalOutputDurationSec} sec · ${storyboardParams?.fps ?? 12} FPS`
        : undefined;
    const renderDurationMs = result.renderDurationMs ?? 0;
    const geometryDetail = meshParams?.density === 'Standard' ? 'Target 250K faces' : 'Target 500K faces';

    const project: ProjectItem = {
      id: projectId,
      title,
      type: workflow,
      createdAt,
      createdAtEpoch: now,
      status: outputMissing ? 'failed' : 'completed',
      sourceImage,
      sourceFilename,
      sourceBlobKey: sourcePreview.sourceBlobKey,
      thumbnailUrl: sourcePreview.thumbnailUrl || sourceImage,
      previewKind: outputPreviewKind(workflow),
      downloadUrl: primaryOutput?.url,
      downloadFilename: primaryOutput?.filename,
      outputFiles: result.outputFiles,
      generationResult: result,
      paramsShot: shotParams,
      paramsStoryboard: storyboardParams,
      paramsMesh: meshParams,
      params3d,
      renderDurationMs,
      totalOutputDurationSec,
      outputAvailability: outputMissing ? 'missing' : 'available',
      postedGraphs: generationGraphsRef.current,
      stats: {
        polygonCount: workflow === 'model' || workflow === 'mesh' ? geometryDetail : undefined,
        resolution: workflow === 'shot' ? shotParams?.aspectRatio ?? '16:9' : workflow === 'storyboard' ? '4 × 16:9 frames' : undefined,
        duration,
        filesize: primaryOutput ? 'ComfyUI local output' : 'Output missing',
        renderTime: formatRenderDuration(renderDurationMs),
      },
    };

    const outputAsset: AssetRecord = {
      id: `asset-output-${now}`,
      projectId,
      title,
      kind: 'output',
      category: workflow,
      workflowTarget: workflow === 'hdri' || workflow === 'mesh' ? undefined : workflow,
      categoryLabel: labelMap[workflow],
      badge: primaryOutput ? `${primaryOutput.extension.toUpperCase()} OUTPUT` : 'OUTPUT MISSING',
      thumbnailUrl: sourcePreview.thumbnailUrl || sourceImage,
      previewKind: outputPreviewKind(workflow),
      fileSize: primaryOutput ? 'ComfyUI local output' : 'Output missing',
      dimensions:
        workflow === 'shot'
          ? `${shotParams?.shots.length ?? result.shotResults?.length ?? 0} shots · ${totalOutputDurationSec} sec · ${shotParams?.aspectRatio ?? '16:9'}`
          : workflow === 'storyboard'
            ? `4 frames · ${totalOutputDurationSec} sec animatic`
            : workflow === 'model' || workflow === 'mesh'
              ? geometryDetail
              : 'Anisotropic Gaussian PLY',
      format: primaryOutput?.extension.toUpperCase() || 'MISSING',
      uploadedAt: createdAt,
      createdAtEpoch: now,
      isGenerated: true,
      sourceImage,
      sourceFilename,
      sourceBlobKey: sourcePreview.sourceBlobKey,
      downloadUrl: primaryOutput?.url,
      downloadFilename: primaryOutput?.filename,
      outputFiles: result.outputFiles,
      generationResult: result,
      renderDurationMs,
      totalOutputDurationSec,
      outputAvailability: primaryOutput ? 'available' : 'missing',
    };

    setProjects((previous) => [project, ...previous]);
    setAssets((previous) => [outputAsset, ...previous]);
    setActiveProject(project);
    setProjectState('completed');
  };

  const handleSelectProjectFromDrawer = (project: ProjectItem) => {
    resetTransientState();
    if (project.type === 'hdri') {
      setActiveWorkflow('home');
      setProjectState('idle');
      return;
    }
    setGenerationResult(project.generationResult ?? null);
    setActiveWorkflow(project.type === 'mesh' ? 'model' : project.type);
    setCurrentImage(project.sourceImage || project.thumbnailUrl);
    setActiveProject(project);
    setProjectState('completed');
  };

  const handleDeleteProject = (id: string) => {
    const project = projects.find((item) => item.id === id);
    const linkedAssets = assets.filter((asset) => asset.projectId === id);
    const keys = new Set<string>(linkedAssets.map((asset) => asset.blobKey).filter((key): key is string => typeof key === 'string'));
    if (project?.sourceBlobKey) {
      const sourceStillUsed = projects.some((item) => item.id !== id && item.sourceBlobKey === project.sourceBlobKey) ||
        assets.some((asset) => asset.projectId !== id && asset.sourceBlobKey === project.sourceBlobKey);
      if (!sourceStillUsed) keys.add(project.sourceBlobKey);
    }
    linkedAssets.forEach((asset) => {
      if (asset.sourceImage?.startsWith('blob:')) URL.revokeObjectURL(asset.sourceImage);
      if (asset.downloadUrl?.startsWith('blob:') && asset.downloadUrl !== asset.sourceImage) URL.revokeObjectURL(asset.downloadUrl);
    });
    void Promise.all([...keys].map((key) => deleteAssetBlob(key)));
    setProjects((previous) => previous.filter((item) => item.id !== id));
    setAssets((previous) => previous.filter((asset) => asset.projectId !== id));
  };

  const handleDeleteAsset = (id: string) => {
    const removed = assets.find((asset) => asset.id === id);
    setAssets((previous) => previous.filter((asset) => asset.id !== id));
    if (removed?.kind === 'output' && removed.blobKey && removed.projectId) {
      setProjects((previous) => previous.map((project) => project.id === removed.projectId ? {
        ...project,
        outputAvailability: 'missing',
        downloadUrl: undefined,
        downloadFilename: undefined,
        outputFiles: [],
        generationResult: project.generationResult ? { ...project.generationResult, outputFiles: [] } : project.generationResult,
        stats: { ...project.stats, filesize: 'Relinked output removed' },
      } : project));
    }
  };

  const handleUpdateAsset = (updatedAsset: AssetRecord) => {
    setAssets((previous) => previous.map((asset) => (asset.id === updatedAsset.id ? updatedAsset : asset)));

    if (!updatedAsset.projectId) return;
    setProjects((previous) => previous.map((project) => {
      if (project.id !== updatedAsset.projectId) return project;
      const primaryOutput = getPrimaryOutputFile(project.type === 'mesh' ? 'model' : project.type, updatedAsset.outputFiles || []);
      return {
        ...project,
        status: primaryOutput ? 'completed' : project.status,
        downloadUrl: primaryOutput?.url || updatedAsset.downloadUrl,
        downloadFilename: primaryOutput?.filename || updatedAsset.downloadFilename,
        outputFiles: updatedAsset.outputFiles,
        generationResult: updatedAsset.generationResult,
        outputAvailability: updatedAsset.outputAvailability,
        stats: {
          ...project.stats,
          filesize: updatedAsset.fileSize,
        },
      };
    }));
  };

  const handleDuplicateProject = (project: ProjectItem) => {
    const now = Date.now();
    const duplicate: ProjectItem = {
      ...project,
      id: `project-copy-${now}`,
      title: `${project.title} Copy`,
      createdAt: new Date(now).toLocaleString(),
      createdAtEpoch: now,
    };
    setProjects((previous) => [duplicate, ...previous]);
  };

  const handleEditScenes = () => {
    if (!activeProject?.paramsShot) return;
    setGenerationError('');
    setGenerationResult(null);
    setSelectedSourceAsset(null);
    setActiveWorkflow('shot');
    setProjectState('idle');
  };

  const handleRerunProject = (project: ProjectItem) => {
    const workflow: WorkflowCreationType = project.type === 'mesh' ? 'model' : project.type;
    const sourceImage = project.sourceImage || project.thumbnailUrl;
    if (!ENABLED_WORKFLOWS.has(workflow) || !sourceImage) return;
    setIsProjectsOpen(false);
    setActiveWorkflow(workflow);
    void handleStartGeneration({
      sourceImage,
      sourceFilename: project.sourceFilename,
      params3d: project.params3d,
      paramsMesh: project.paramsMesh,
      paramsShot: project.paramsShot,
      paramsStoryboard: project.paramsStoryboard,
    }, workflow);
  };

  return (
    <div className="min-h-screen w-full bg-[#040209] text-white relative selection:bg-white selection:text-black font-sans overflow-x-hidden flex flex-col justify-between">
      <div className="fixed inset-0 -z-20 overflow-hidden pointer-events-none bg-[#040209]" aria-hidden="true">
        <div className="absolute top-[15%] right-[5%] w-[60vw] h-[60vw] max-w-[850px] max-h-[850px] rounded-full bg-gradient-to-br from-[#581c87]/30 via-[#3b0764]/20 to-transparent blur-[160px]" />
        <div className="absolute top-[35%] right-[25%] w-[45vw] h-[45vw] max-w-[650px] max-h-[650px] rounded-full bg-gradient-to-tr from-[#6b21a8]/25 via-[#2e1065]/15 to-transparent blur-[140px]" />
      </div>

      <Header
        onGoHome={handleGoHome}
        onGoLanding={handleGoLanding}
        onOpenProjects={() => setIsProjectsOpen(true)}
        onGoAssets={handleGoAssets}
        onGoTasks={handleGoTasks}
        onGoEdit={handleGoEdit}
        activeWorkflow={activeWorkflow}
        projectCount={projects.length}
        libraryStatus={libraryStatus}
      />

      <main id="main-content" className="flex-1 flex flex-col justify-center relative z-10 py-4" tabIndex={-1}>
        <AnimatePresence mode="wait">
          {activeWorkflow === 'landing' && <LandingScreen key="landing" onProceed={handleProceed} />}
          {activeWorkflow === 'home' && <HomeScreen key="home" onSelectWorkflow={openWorkflow} />}
          {activeWorkflow === 'tasks' && <TasksView key="tasks" />}
          {activeWorkflow === 'edit' && (
            <EditView
              key="edit"
              assets={assets}
              onCreated={(asset) => setAssets((previous) => [asset, ...previous])}
            />
          )}
          {activeWorkflow === 'assets' && (
            <AssetsView
              key="assets"
              assets={assets}
              onDeleteAsset={handleDeleteAsset}
              onAddAsset={(asset) => setAssets((previous) => [asset, ...previous])}
              onUpdateAsset={handleUpdateAsset}
              onSelectWorkflow={openWorkflow}
              onViewAsset={handleViewOutputAsset}
              onUseSourceAsset={handleUseSourceAsset}
            />
          )}
          {ENABLED_WORKFLOWS.has(activeWorkflow as WorkflowCreationType) && projectState === 'idle' && (
            <WorkflowPanel
              key={`panel-${activeWorkflow}-${selectedSourceAsset?.id || 'blank'}`}
              workflow={activeWorkflow as WorkflowCreationType}
              onBack={handleGoHome}
              onStartGeneration={handleStartGeneration}
              prefillAsset={selectedSourceAsset}
              prefillProject={activeWorkflow === 'shot' ? activeProject : null}
            />
          )}
          {ENABLED_WORKFLOWS.has(activeWorkflow as WorkflowCreationType) && projectState === 'processing' && (
            <ProcessingView
              key={`processing-${activeWorkflow}`}
              workflow={activeWorkflow as WorkflowCreationType}
              sourceImage={currentImage}
              progress={generationProgress}
              error={generationError}
              manualShotControl={manualShotControl}
              distributedShotControls={distributedShotControls}
              onRunCurrentShot={handleRunCurrentShot}
              onRunDistributedShot={handleRunDistributedShot}
              onRunAllReadyShots={handleRunAllReadyShots}
              onCancelDistributedShot={handleCancelDistributedShot}
              onCancel={handleCancelGeneration}
              onBack={() => setProjectState('idle')}
            />
          )}
          {ENABLED_WORKFLOWS.has(activeWorkflow as WorkflowCreationType) && projectState === 'completed' && (
            <CompletedView
              key={`completed-${activeWorkflow}-${activeProject?.id || generationResult?.promptId || 'current'}`}
              workflow={activeWorkflow as WorkflowCreationType}
              sourceImage={currentImage}
              projectItem={activeProject || undefined}
              generationResult={generationResult}
              onEditScenes={activeWorkflow === 'shot' && activeProject?.paramsShot ? handleEditScenes : undefined}
              onCreateAnother={() => {
                resetTransientState();
                setProjectState('idle');
              }}
              onSaveToProjects={(item) => setProjects((previous) => [item, ...previous])}
              onGoAssets={handleGoAssets}
            />
          )}
        </AnimatePresence>
      </main>

      <ProjectsDrawer
        isOpen={isProjectsOpen}
        onClose={() => setIsProjectsOpen(false)}
        projects={projects}
        onSelectProject={handleSelectProjectFromDrawer}
        onDeleteProject={handleDeleteProject}
        onDuplicateProject={handleDuplicateProject}
        onRerunProject={handleRerunProject}
      />

      {activeWorkflow !== 'landing' && (
        <TasksDock hidden={activeWorkflow === 'tasks'} onOpenTasks={handleGoTasks} />
      )}

      {activeWorkflow !== 'landing' && (
        <footer className="w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-center text-[11px] font-mono text-white/40 border-t border-white/5 relative z-10">
          <span>© {new Date().getFullYear()} DREAMFRAME · LOCAL WORKSPACE</span>
        </footer>
      )}
    </div>
  );
}
