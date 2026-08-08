import type { CameraMotion, CinemaLens, DistributedShotStatus, ShotDuration, VideoAspectRatio, VideoFrameRate, VideoQualityMode, WorkflowCreationType } from '../types';
import type { RenderWorker } from './renderWorkers';
import type { TaskTag } from './comfyQueue';
import { clearTaskProgress, publishTaskProgress } from './taskStore';
import { getBrowserCapabilityIssues, getSourceImageDimensions, validateWorkflowSource } from './preflight';

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: 'input' | 'output' | 'temp';
  url: string;
  extension: string;
}

export interface ShotGenerationResult {
  index: number;
  title: string;
  prompt: string;
  negativePrompt?: string;
  duration: ShotDuration;
  actualDurationSec?: number;
  promptId: string;
  outputFiles: ComfyOutputFile[];
  status?: DistributedShotStatus;
  workerId?: string;
  workerName?: string;
  error?: string;
}

export interface GenerationResult {
  promptId: string;
  outputFiles: ComfyOutputFile[];
  history: Record<string, unknown>;
  warning?: string;
  shotResults?: ShotGenerationResult[];
  renderDurationMs?: number;
  totalOutputDurationSec?: number;
}

export interface GenerationProgress {
  percent: number;
  status: string;
  nodeId?: string;
}

export interface AwaitShotStartContext {
  index: number;
  totalShots: number;
  shot: MultiShotWorkflowBeat;
}

interface BaseRunWorkflowOptions {
  sourceImage: string;
  sourceFilename?: string;
  signal?: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
  onPromptId?: (promptId: string) => void;
  preflightPassed?: boolean;
  apiBase?: string;
  /** Stamped into extra_data so the Tasks page can name this prompt when it reads the queue. */
  tag?: TaskTag;
  /** Receives the graph exactly as posted, so the Workflow tab shows the object that was sent. */
  onGraph?: (graph: Record<string, any>, meta: PostedGraphMeta) => void;
}

export interface PostedGraphMeta {
  promptId: string;
  label: string;
  engine: string;
  shotIndex?: number;
  apiBase?: string;
}

interface RunTrellisWorkflowOptions extends BaseRunWorkflowOptions {
  density?: 'Standard' | 'Ultra High';
  lowVram?: boolean;
}

export interface RunStoryboardWorkflowOptions extends BaseRunWorkflowOptions {
  shotPrompts: [string, string, string, string];
  styleInfluence?: number;
  holdSeconds?: 1 | 2 | 3;
  fps?: 12 | 24;
  seed?: number;
}

export interface RunWanVideoWorkflowOptions extends BaseRunWorkflowOptions {
  prompt: string;
  negativePrompt?: string;
  title?: string;
  aspectRatio?: VideoAspectRatio;
  cameraMotion?: CameraMotion;
  focalLength?: CinemaLens;
  fps?: VideoFrameRate;
  duration?: ShotDuration;
  seed?: number;
  qualityMode?: VideoQualityMode;
  continuityMode?: 'Strict' | 'Natural';
  sequenceIndex?: number;
}

export interface MultiShotWorkflowBeat {
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

export interface RunWanMultiShotWorkflowOptions extends BaseRunWorkflowOptions {
  shots: MultiShotWorkflowBeat[];
  aspectRatio: VideoAspectRatio;
  fps: VideoFrameRate;
  qualityMode: VideoQualityMode;
  continuityMode: 'Strict' | 'Natural';
  seed?: number;
  onAwaitShotStart?: (context: AwaitShotStartContext) => Promise<void> | void;
}

export interface DistributedShotUpdate {
  index: number;
  title: string;
  workerId: string;
  workerName: string;
  status: DistributedShotStatus;
  percent: number;
  message: string;
  promptId?: string;
  error?: string;
}

export interface RunWanDistributedMultiShotWorkflowOptions extends Omit<RunWanMultiShotWorkflowOptions, 'onAwaitShotStart'> {
  workers: RenderWorker[];
  onAwaitShotStart?: (context: AwaitShotStartContext & { worker: RenderWorker; dependencyIndex: number | null }) => Promise<void> | void;
  onShotUpdate?: (update: DistributedShotUpdate) => void;
  onShotPromptId?: (index: number, promptId: string, worker: RenderWorker) => void;
  getShotSignal?: (index: number) => AbortSignal | undefined;
}

const API_BASE = '/comfy';

function resolveApiBase(apiBase?: string): string {
  const value = (apiBase || API_BASE).trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const TRELLIS_WORKFLOW_URL = '/workflows/trellis2-image-to-3d.json';
const WAN_VIDEO_WORKFLOW_URL = '/workflows/wan2.2-shot-editor-i2v.json';
const SHARP_GAUSSIAN_WORKFLOW_URL = '/workflows/apple-sharp-panorama-to-gaussian.json';
const STORYBOARD_WORKFLOW_URL = '/workflows/four-beat-storyboard-animatic.json';
const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'ply', 'stl', 'fbx', 'usd', 'usdz']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'gif']);
const DOWNLOADABLE_EXTENSIONS = new Set([...MODEL_EXTENSIONS, ...VIDEO_EXTENSIONS]);

function report(
  callback: BaseRunWorkflowOptions['onProgress'],
  percent: number,
  status: string,
  nodeId?: string,
) {
  callback?.({ percent: Math.max(0, Math.min(100, Math.round(percent))), status, nodeId });
}

function emitGraph(
  options: BaseRunWorkflowOptions,
  graph: Record<string, any>,
  promptId: string,
  engine: string,
) {
  options.onGraph?.(structuredClone(graph), {
    promptId,
    label: options.tag?.shotTitle || options.tag?.title || engine,
    engine,
    shotIndex: options.tag?.shotIndex,
    apiBase: options.apiBase,
  });
}

async function ensureOk(response: Response, context: string): Promise<Response> {
  if (response.ok) return response;

  const rawBody = await response.text().catch(() => '');
  let details = rawBody;

  if (rawBody) {
    try {
      details = JSON.stringify(JSON.parse(rawBody), null, 2);
    } catch {
      // Keep the original text response.
    }
  }

  throw new Error(`${context} failed (${response.status}).${details ? `\n${details}` : ''}`);
}

function basenameFromUrl(value: string): string {
  const withoutQuery = value.split('?')[0];
  return withoutQuery.split(/[\\/]/).pop() || `dreamframe-${Date.now()}.png`;
}

async function sourceToBlob(
  source: string,
  preferredFilename?: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(source, { signal });
  await ensureOk(response, 'Reading the source image');
  const blob = await response.blob();
  const mimeExtension = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('x-exr', 'exr').replace('vnd.radiance', 'hdr');
  const originalName = preferredFilename || basenameFromUrl(source);
  const safeName = originalName.split(/[\/]/).pop() || '';
  const filename = safeName.includes('.') ? safeName : `dreamframe-${Date.now()}.${mimeExtension || 'png'}`;
  return { blob, filename };
}

async function checkComfy(signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  try {
    const response = await fetch(`${resolveApiBase(apiBase)}/system_stats`, {
      signal,
      cache: 'no-store',
    });
    await ensureOk(response, 'Connecting to ComfyUI');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(
      'DreamFrame could not reach ComfyUI. Open Comfy Desktop, start the instance that contains the required workflow nodes and models, and confirm its port in .env.local.',
      { cause: error },
    );
  }
}

async function checkRequiredNodes(nodeClasses: string[], signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  for (const nodeClass of nodeClasses) {
    const response = await fetch(`${resolveApiBase(apiBase)}/object_info/${encodeURIComponent(nodeClass)}`, {
      signal,
      cache: 'no-store',
    });
    await ensureOk(response, `Checking ${nodeClass}`);
    const info = await response.json();

    if (!info?.[nodeClass] || Object.keys(info[nodeClass]).length === 0) {
      throw new Error(
        `Your Comfy Desktop instance does not expose ${nodeClass}. Install or update the node pack used by the supplied workflow, restart ComfyUI, and try again.`,
      );
    }
  }
}


function choiceValuesFromDefinition(definition: unknown): string[] | null {
  if (!Array.isArray(definition) || !Array.isArray(definition[0])) return null;
  return definition[0].filter((value): value is string => typeof value === 'string');
}

async function checkWorkflowSelections(workflow: Record<string, any>, signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  const schemaCache = new Map<string, Record<string, unknown> | null>();

  for (const [nodeId, node] of Object.entries(workflow)) {
    const classType = node?.class_type;
    if (!classType || !node?.inputs) continue;

    if (!schemaCache.has(classType)) {
      const response = await fetch(`${resolveApiBase(apiBase)}/object_info/${encodeURIComponent(classType)}`, { signal, cache: 'no-store' });
      await ensureOk(response, `Checking ${classType} selections`);
      const payload = await response.json();
      const schema = payload?.[classType]?.input;
      schemaCache.set(
        classType,
        schema ? ({ ...(schema.required || {}), ...(schema.optional || {}) } as Record<string, unknown>) : null,
      );
    }

    const definitions = schemaCache.get(classType);
    if (!definitions) continue;
    for (const [inputName, selectedValue] of Object.entries(node.inputs as Record<string, unknown>)) {
      if (typeof selectedValue !== 'string') continue;
      const choices = choiceValuesFromDefinition(definitions[inputName]);
      if (choices && choices.length > 0 && !choices.includes(selectedValue)) {
        throw new Error(`Preflight found a missing model or selection in node ${nodeId} (${classType}). Expected “${selectedValue}”, but it is not available in this ComfyUI installation.`);
      }
    }
  }
}

async function checkSystemResources(workflow: WorkflowCreationType, signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  const response = await fetch(`${resolveApiBase(apiBase)}/system_stats`, { signal, cache: 'no-store' });
  await ensureOk(response, 'Checking local render resources');
  const stats = await response.json();
  const device = Array.isArray(stats?.devices) ? stats.devices[0] : undefined;
  const freeVram = Number(device?.vram_free ?? device?.vram_free_bytes ?? 0);
  const minimum = workflow === 'shot' ? 2 * 1024 ** 3 : workflow === 'model' ? 1.5 * 1024 ** 3 : 0;
  if (minimum > 0 && freeVram > 0 && freeVram < minimum) {
    throw new Error(`Preflight found less than ${(minimum / 1024 ** 3).toFixed(1)} GB of free VRAM. Close other GPU applications or use a lighter workflow option before rendering.`);
  }
}

async function checkTexturedGlbSupport(signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  await checkRequiredNodes(['Trellis2RasterizePBR', 'Trellis2ExportTrimesh', 'Preview3D'], signal, apiBase);
}

async function checkWanVideoSupport(signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  await checkRequiredNodes(
    ['WanImageToVideo', 'CreateVideo', 'SaveVideo', 'ComfySwitchNode', 'ComfyMathExpression'],
    signal,
    apiBase,
  );
}


async function checkStoryboardSupport(signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  await checkRequiredNodes(
    ['IPAdapterUnifiedLoader', 'IPAdapter', 'RepeatImageBatch', 'ImageBatch', 'CreateVideo', 'SaveVideo'],
    signal,
    apiBase,
  );
}

async function checkSharpGaussianSupport(signal?: AbortSignal, apiBase = API_BASE): Promise<void> {
  await checkRequiredNodes(
    [
      'LoadSharpModel',
      'MergeGaussians',
      'PanoramaWrap',
      'PanoramaDepthMerge',
      'SharpRayToPlanarDepth',
      'SharpPredictGaussiansFromMetricDepth',
      'TransformGaussian',
      'DownloadAndLoadMoGe2Model',
      'MoGe2Inference',
      'PanoramaSplitAdaptive',
      'PreviewGaussians',
      'PanoramaSplit',
    ],
    signal,
    apiBase,
  );
}

export async function uploadImage(
  blob: Blob,
  filename: string,
  signal?: AbortSignal,
  apiBase = API_BASE,
): Promise<{ name: string; subfolder?: string; type?: string }> {
  const form = new FormData();
  form.append('image', blob, filename);
  form.append('type', 'input');
  form.append('overwrite', 'true');

  const response = await fetch(`${resolveApiBase(apiBase)}/upload/image`, {
    method: 'POST',
    body: form,
    signal,
  });
  await ensureOk(response, 'Uploading the source image to ComfyUI');
  return response.json();
}

async function loadWorkflow(
  workflowUrl: string,
  workflowName: string,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const response = await fetch(workflowUrl, { signal, cache: 'no-store' });
  await ensureOk(response, `Loading the ${workflowName} API workflow`);
  return response.json();
}


export interface WorkflowPreflightOptions {
  workflow: WorkflowCreationType;
  sourceImage: string;
  sourceFilename?: string;
  signal?: AbortSignal;
  onProgress?: (progress: GenerationProgress) => void;
  apiBase?: string;
}

export async function runWorkflowPreflight(options: WorkflowPreflightOptions): Promise<void> {
  report(options.onProgress, 2, 'Checking browser capabilities');
  const capabilityIssues = getBrowserCapabilityIssues(options.workflow);
  if (capabilityIssues.length) throw new Error(capabilityIssues.join('\n'));
  const dimensions = await getSourceImageDimensions(options.sourceImage, options.sourceFilename);
  const sourceIssues = validateWorkflowSource({
    workflow: options.workflow,
    sourceImage: options.sourceImage,
    sourceFilename: options.sourceFilename,
    dimensions,
  });
  if (sourceIssues.length) throw new Error(sourceIssues.join('\n'));
  report(options.onProgress, 5, 'Connecting to Comfy Desktop');
  await checkComfy(options.signal, options.apiBase);

  report(options.onProgress, 8, 'Checking workflow nodes and templates');
  let template: Record<string, any> | null = null;
  switch (options.workflow) {
    case '3d':
      await checkSharpGaussianSupport(options.signal, options.apiBase);
      template = await loadWorkflow(SHARP_GAUSSIAN_WORKFLOW_URL, 'Apple SHARP panorama-to-Gaussian', options.signal);
      break;
    case 'model':
      await checkTexturedGlbSupport(options.signal, options.apiBase);
      template = await loadWorkflow(TRELLIS_WORKFLOW_URL, 'TRELLIS.2', options.signal);
      break;
    case 'shot':
      await checkWanVideoSupport(options.signal, options.apiBase);
      template = await loadWorkflow(WAN_VIDEO_WORKFLOW_URL, 'WAN 2.2 shot editor workflow', options.signal);
      break;
    case 'storyboard':
      await checkStoryboardSupport(options.signal, options.apiBase);
      template = await loadWorkflow(STORYBOARD_WORKFLOW_URL, 'four-beat storyboard animatic', options.signal);
      break;
    case 'mesh':
      throw new Error('Surface Mesh was removed. Use 3D Model Generation instead.');
    case 'hdri':
      throw new Error('The HDRI workflow is disabled because no production workflow is connected yet.');
  }

  if (template) await checkWorkflowSelections(template, options.signal, options.apiBase);
  await checkSystemResources(options.workflow, options.signal, options.apiBase);
  report(options.onProgress, 10, 'Preflight checks passed');
}

function patchTrellisWorkflow(
  workflow: Record<string, any>,
  uploadedImageName: string,
  density: RunTrellisWorkflowOptions['density'],
  lowVram: boolean,
): Record<string, any> {
  const copy = structuredClone(workflow);

  if (!copy['1']?.inputs) throw new Error('Workflow node 1 (Load Image) is missing.');
  copy['1'].inputs.image = uploadedImageName;

  if (copy['69']?.inputs) copy['69'].inputs.low_vram = lowVram;
  if (copy['81']?.inputs) copy['81'].inputs.low_vram = lowVram;

  const randomSeed = () => Math.floor(Math.random() * 2_147_483_647);
  if (copy['91']?.inputs) copy['91'].inputs.seed = randomSeed();
  if (copy['96']?.inputs) copy['96'].inputs.seed = randomSeed();

  const targetFaces = density === 'Standard' ? 250_000 : 500_000;
  if (copy['97']?.inputs) copy['97'].inputs.target_face_count = targetFaces;

  if (!copy['98']?.inputs || !copy['99']?.inputs || !copy['101']?.inputs) {
    throw new Error('The textured or untextured GLB output nodes are missing from the workflow.');
  }
  copy['98'].inputs.texture_size = density === 'Standard' ? 1024 : 2048;
  copy['99'].inputs.filename_prefix = 'dreamframe_textured';
  copy['99'].inputs.file_format = 'glb';
  copy['101'].inputs.filename_prefix = 'dreamframe_untextured';
  copy['101'].inputs.file_format = 'glb';

  return copy;
}

function patchSharpGaussianWorkflow(
  workflow: Record<string, any>,
  uploadedImageName: string,
): Record<string, any> {
  const copy = structuredClone(workflow);
  const runId = Date.now();

  if (!copy['7']?.inputs) throw new Error('Workflow node 7 (Load Image) is missing.');
  if (!copy['54']?.inputs) throw new Error('Workflow node 54 (Merge Gaussians) is missing.');
  if (!copy['76']?.inputs) throw new Error('Workflow node 76 (SHARP Predict Gaussians) is missing.');
  if (!copy['78']?.inputs) throw new Error('Workflow node 78 (Transform Gaussian) is missing.');

  copy['7'].inputs.image = uploadedImageName;
  copy['54'].inputs.output_prefix = `dreamframe_gaussian_merged_${runId}`;
  copy['76'].inputs.output_prefix = `dreamframe_sharp_aligned_${runId}`;
  if (copy['96']?.inputs) copy['96'].inputs.fname = `dreamframe_pano_bank_${runId}`;

  return copy;
}

function buildStoryboardPrompt(prompt: string): string {
  const direction = prompt.trim();
  const continuity =
    'Maintain clear character, wardrobe, prop, environment, scale, and screen-direction continuity with the surrounding storyboard frames.';
  const storyboardFinish =
    'Match the uploaded storyboard look reference and its visual language. SINGLE 16:9 STORYBOARD FRAME, readable staging, strong silhouettes, cinematic composition, animation-production storyboard finish, no text, no arrows, no captions, no speech bubbles, no logos, no watermark, no panel border.';

  return [direction, continuity, storyboardFinish].filter(Boolean).join('\n\n');
}

function patchStoryboardWorkflow(
  workflow: Record<string, any>,
  uploadedReferenceName: string,
  options: RunStoryboardWorkflowOptions,
): Record<string, any> {
  const copy = structuredClone(workflow);
  const promptNodes = ['6', '11', '16', '21'];
  const samplerNodes = ['8', '13', '18', '23'];
  const influence = Math.max(0, Math.min(1, Number(options.styleInfluence ?? 0.65)));
  const baseSeed = Number.isFinite(options.seed)
    ? Math.max(0, Math.floor(options.seed as number))
    : Math.floor(Math.random() * 2_147_483_000);

  if (!copy['2']?.inputs) throw new Error('Workflow node 2 (Storyboard Style Reference) is missing.');
  if (!copy['4']?.inputs) throw new Error('Workflow node 4 (Apply Storyboard Style) is missing.');
  if (!copy['30']?.inputs) throw new Error('Workflow node 30 (Save Storyboard Animatic) is missing.');

  if (options.shotPrompts.length !== 4 || options.shotPrompts.some((prompt) => !prompt.trim())) {
    throw new Error('All four storyboard beat prompts are required.');
  }

  copy['2'].inputs.image = uploadedReferenceName;
  copy['4'].inputs.weight = influence;
  copy['4'].inputs.start_at = 0;
  copy['4'].inputs.end_at = 1;

  promptNodes.forEach((nodeId, index) => {
    if (!copy[nodeId]?.inputs) throw new Error(`Workflow prompt node ${nodeId} is missing.`);
    copy[nodeId].inputs.text = buildStoryboardPrompt(options.shotPrompts[index]);
  });

  samplerNodes.forEach((nodeId, index) => {
    if (!copy[nodeId]?.inputs) throw new Error(`Workflow sampler node ${nodeId} is missing.`);
    copy[nodeId].inputs.seed = baseSeed + index;
  });

  const fps = options.fps ?? 12;
  const holdSeconds = options.holdSeconds ?? 2;
  ['10', '15', '20', '25'].forEach((nodeId) => {
    if (!copy[nodeId]?.inputs) throw new Error(`Workflow hold node ${nodeId} is missing.`);
    copy[nodeId].inputs.amount = fps * holdSeconds;
  });
  if (!copy['29']?.inputs) throw new Error('Workflow node 29 (Create Storyboard Video) is missing.');
  copy['29'].inputs.fps = fps;
  copy['30'].inputs.filename_prefix = `video/dreamframe_four_beat_storyboard_${Date.now()}`;
  copy['30'].inputs.format = 'mp4';
  copy['30'].inputs.codec = 'h264';

  return copy;
}

function getWanDimensions(aspectRatio: RunWanVideoWorkflowOptions['aspectRatio']): { width: number; height: number } {
  if (aspectRatio === '2.39:1 Anamorphic') return { width: 1536, height: 640 };
  if (aspectRatio === '9:16') return { width: 720, height: 1280 };
  return { width: 1680, height: 944 };
}

function buildWanPrompt(options: RunWanVideoWorkflowOptions): string {
  const continuity = options.continuityMode === 'Natural'
    ? 'Use the uploaded frame as the first frame of this shot. Preserve the main subject, wardrobe, environment, lighting direction, color palette, and screen direction while allowing natural cinematic evolution between shots. No cuts inside this shot.'
    : 'Preserve the exact subjects, faces, wardrobe, props, environment, lighting direction, color palette, and spatial layout from the uploaded continuity frame. Treat the image as the first frame of the next shot. Maintain strict shot-to-shot continuity and coherent screen direction. No cuts inside this shot.';
  const camera = `Camera movement: ${options.cameraMotion ?? 'Dolly In'}. Use a ${options.focalLength ?? '35mm'} cinema lens with natural parallax, physically believable motion, stable subject identity, and cinematic depth of field.`;
  const finish =
    'Photorealistic cinematic video, natural body and object motion, realistic temporal consistency, detailed textures, controlled motion blur, subtle film grain, no subtitles, no logos, no sudden style changes.';

  return [options.prompt.trim(), continuity, camera, finish].filter(Boolean).join('\n\n');
}

function patchWanVideoWorkflow(
  workflow: Record<string, any>,
  uploadedImageName: string,
  options: RunWanVideoWorkflowOptions,
): Record<string, any> {
  const copy = structuredClone(workflow);
  const dimensions = getWanDimensions(options.aspectRatio);
  const seed = Number.isFinite(options.seed)
    ? Math.max(0, Math.floor(options.seed as number))
    : Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

  if (!copy['97']?.inputs) throw new Error('Workflow node 97 (Load Image) is missing.');
  if (!copy['129:93']?.inputs) throw new Error('Workflow node 129:93 (Positive Prompt) is missing.');
  if (!copy['129:98']?.inputs) throw new Error('Workflow node 129:98 (WanImageToVideo) is missing.');
  if (!copy['108']?.inputs) throw new Error('Workflow node 108 (Save Video) is missing.');

  copy['97'].inputs.image = uploadedImageName;
  copy['129:93'].inputs.text = buildWanPrompt(options);
  if (copy['129:89']?.inputs && options.negativePrompt?.trim()) {
    const baseNegative = String(copy['129:89'].inputs.text || '').trim();
    copy['129:89'].inputs.text = [options.negativePrompt.trim(), baseNegative].filter(Boolean).join(', ');
  }
  copy['129:98'].inputs.width = dimensions.width;
  copy['129:98'].inputs.height = dimensions.height;

  if (copy['129:161']?.inputs) copy['129:161'].inputs.value = options.duration ?? 5;
  if (copy['129:162']?.inputs) copy['129:162'].inputs.value = options.fps ?? 16;
  if (copy['129:131']?.inputs) copy['129:131'].inputs.value = options.qualityMode === 'Fast';
  if (copy['129:86']?.inputs) copy['129:86'].inputs.noise_seed = seed;

  copy['108'].inputs.filename_prefix = `video/dreamframe_sequence_shot_${String((options.sequenceIndex ?? 0) + 1).padStart(2, '0')}_${Date.now()}`;
  copy['108'].inputs.format = 'auto';
  copy['108'].inputs.codec = 'auto';

  return copy;
}

async function queueWorkflow(
  workflow: Record<string, any>,
  clientId: string,
  workflowName: string,
  signal?: AbortSignal,
  apiBase = API_BASE,
  tag?: TaskTag,
): Promise<string> {
  const body: Record<string, unknown> = { prompt: workflow, client_id: clientId };
  if (tag) body.extra_data = { dreamframe: { ...tag, queuedAt: Date.now() } };
  const response = await fetch(`${resolveApiBase(apiBase)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  await ensureOk(response, `Queueing the ${workflowName} workflow`);
  const payload = await response.json();

  if (!payload.prompt_id) {
    throw new Error(`ComfyUI did not return a prompt ID. ${JSON.stringify(payload)}`);
  }

  return payload.prompt_id as string;
}

function buildWebSocketUrl(clientId: string, apiBase = API_BASE): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${resolveApiBase(apiBase)}/ws?clientId=${encodeURIComponent(clientId)}`;
}

async function getHistory(promptId: string, signal?: AbortSignal, apiBase = API_BASE): Promise<any | null> {
  const response = await fetch(`${resolveApiBase(apiBase)}/history/${encodeURIComponent(promptId)}`, {
    signal,
    cache: 'no-store',
  });
  await ensureOk(response, 'Reading ComfyUI history');
  const history = await response.json();
  return history[promptId] ?? null;
}

function normalizeType(value: unknown, fallback: ComfyOutputFile['type']): ComfyOutputFile['type'] {
  return value === 'input' || value === 'output' || value === 'temp' ? value : fallback;
}

function makeOutputFile(
  filename: string,
  type: ComfyOutputFile['type'] = 'output',
  subfolder = '',
  apiBase = API_BASE,
): ComfyOutputFile | null {
  const normalized = filename.replace(/\\/g, '/');
  let relativePath = normalized;
  let resolvedType = type;

  const outputMarker = normalized.toLowerCase().lastIndexOf('/output/');
  const tempMarker = normalized.toLowerCase().lastIndexOf('/temp/');
  if (outputMarker >= 0) {
    relativePath = normalized.slice(outputMarker + '/output/'.length);
    resolvedType = 'output';
  } else if (tempMarker >= 0) {
    relativePath = normalized.slice(tempMarker + '/temp/'.length);
    resolvedType = 'temp';
  }

  const pathParts = relativePath.split('/').filter(Boolean);
  const cleanName = pathParts.pop() || filename;
  const derivedSubfolder = subfolder || pathParts.join('/');
  const extension = cleanName.split('.').pop()?.toLowerCase() || '';
  if (!DOWNLOADABLE_EXTENSIONS.has(extension)) return null;

  const params = new URLSearchParams({ filename: cleanName, subfolder: derivedSubfolder, type: resolvedType });
  return {
    filename: cleanName,
    subfolder: derivedSubfolder,
    type: resolvedType,
    extension,
    url: `${resolveApiBase(apiBase)}/view?${params.toString()}`,
  };
}

export function extractOutputFiles(historyItem: any, apiBase = API_BASE): ComfyOutputFile[] {
  const files: ComfyOutputFile[] = [];
  const seen = new Set<string>();

  const add = (file: ComfyOutputFile | null) => {
    if (!file) return;
    const key = `${file.type}:${file.subfolder}:${file.filename}`;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(file);
    }
  };

  const visit = (value: unknown, keyHint = '') => {
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if ([...DOWNLOADABLE_EXTENSIONS].some((ext) => lower.endsWith(`.${ext}`))) {
        const fallbackType: ComfyOutputFile['type'] =
          keyHint.toLowerCase().includes('preview') || value.includes('preview_') ? 'temp' : 'output';
        add(makeOutputFile(value, fallbackType, '', apiBase));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, keyHint));
      return;
    }

    if (!value || typeof value !== 'object') return;
    const objectValue = value as Record<string, unknown>;

    if (typeof objectValue.filename === 'string') {
      add(
        makeOutputFile(
          objectValue.filename,
          normalizeType(objectValue.type, 'output'),
          typeof objectValue.subfolder === 'string' ? objectValue.subfolder : '',
          apiBase,
        ),
      );
    }

    Object.entries(objectValue).forEach(([key, child]) => visit(child, key));
  };

  visit(historyItem?.outputs ?? historyItem);
  return files;
}

async function waitForCompletion(
  promptId: string,
  clientId: string,
  options: BaseRunWorkflowOptions,
  labels: { running: string; waiting: string; timeoutMinutes: number },
): Promise<any> {
  const { signal, onProgress } = options;
  let socket: WebSocket | null = null;
  let lastProgress = 45;
  let executionError: Error | null = null;

  try {
    socket = new WebSocket(buildWebSocketUrl(clientId, options.apiBase));
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data);
        const data = message.data ?? {};
        if (data.prompt_id && data.prompt_id !== promptId) return;

        if (message.type === 'progress' && Number(data.max) > 0) {
          const nodeProgress = Number(data.value) / Number(data.max);
          lastProgress = Math.max(lastProgress, 45 + nodeProgress * 48);
          report(onProgress, lastProgress, labels.running, String(data.node ?? ''));
          publishTaskProgress(promptId, lastProgress, labels.running, String(data.node ?? ''));
        } else if (message.type === 'executing' && data.node) {
          lastProgress = Math.min(94, lastProgress + 2);
          report(onProgress, lastProgress, `Running ComfyUI node ${data.node}`, String(data.node));
          publishTaskProgress(promptId, lastProgress, `Running node ${data.node}`, String(data.node));
        } else if (message.type === 'execution_error') {
          const detail = data.exception_message || data.exception_type || 'Unknown ComfyUI execution error';
          executionError = new Error(`ComfyUI failed while running node ${data.node_id ?? 'unknown'}: ${detail}`);
        }
      } catch {
        // Ignore non-JSON websocket messages such as binary previews.
      }
    });
  } catch {
    // History polling below remains the source of truth.
  }

  const started = Date.now();
  const timeoutMs = labels.timeoutMinutes * 60 * 1000;

  try {
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
      if (executionError) throw executionError;

      const historyItem = await getHistory(promptId, signal, options.apiBase);
      if (historyItem) {
        const status = historyItem.status;
        if (status?.status_str === 'error') {
          throw new Error('ComfyUI reported that the workflow failed. Check the Comfy Desktop console for the full node error.');
        }
        return historyItem;
      }

      report(onProgress, Math.min(94, lastProgress), labels.waiting);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    socket?.close();
    clearTaskProgress(promptId);
  }

  throw new Error(`Generation timed out after ${labels.timeoutMinutes} minutes.`);
}

export interface RunGraphOptions {
  graph: Record<string, any>;
  name: string;
  apiBase?: string;
  signal?: AbortSignal;
  tag?: TaskTag;
  onProgress?: (progress: GenerationProgress) => void;
  onPromptId?: (promptId: string) => void;
  timeoutMinutes?: number;
}

/**
 * Post a graph this app built and wait for it. The editing tools use this rather than the
 * template runners, so they inherit the same queueing, progress reporting and Tasks tagging.
 */
export async function runGraph(options: RunGraphOptions): Promise<{ promptId: string; outputFiles: ComfyOutputFile[] }> {
  const clientId = crypto.randomUUID();
  const base: BaseRunWorkflowOptions = {
    sourceImage: '',
    signal: options.signal,
    onProgress: options.onProgress,
    apiBase: options.apiBase,
    tag: options.tag,
  };
  const promptId = await queueWorkflow(
    options.graph,
    clientId,
    options.name,
    options.signal,
    options.apiBase,
    options.tag,
  );
  options.onPromptId?.(promptId);
  const history = await waitForCompletion(promptId, clientId, base, {
    running: `Running ${options.name}`,
    waiting: `${options.name} is waiting on ComfyUI`,
    timeoutMinutes: options.timeoutMinutes ?? 45,
  });
  return { promptId, outputFiles: extractOutputFiles(history, options.apiBase) };
}

export async function runSharpGaussianWorkflow(options: BaseRunWorkflowOptions): Promise<GenerationResult> {
  if (!options.preflightPassed) {
    report(options.onProgress, 5, 'Connecting to Comfy Desktop');
    await checkComfy(options.signal, options.apiBase);
    report(options.onProgress, 10, 'Checking Apple SHARP and panorama nodes');
    await checkSharpGaussianSupport(options.signal, options.apiBase);
  }

  report(options.onProgress, 15, 'Preparing 360° equirectangular panorama');
  const { blob, filename } = await sourceToBlob(options.sourceImage, options.sourceFilename, options.signal);

  report(options.onProgress, 25, 'Uploading HDRI panorama to ComfyUI');
  const uploaded = await uploadImage(blob, filename, options.signal, options.apiBase);

  report(options.onProgress, 35, 'Preparing the SHARP Gaussian splat workflow');
  const template = await loadWorkflow(SHARP_GAUSSIAN_WORKFLOW_URL, 'Apple SHARP panorama-to-Gaussian', options.signal);
  const workflow = patchSharpGaussianWorkflow(template, uploaded.name);

  const clientId = crypto.randomUUID();
  report(options.onProgress, 42, 'Adding Gaussian workflow to the local queue');
  const promptId = await queueWorkflow(workflow, clientId, 'Apple SHARP panorama-to-Gaussian', options.signal, options.apiBase, options.tag);
  options.onPromptId?.(promptId);
  emitGraph(options, workflow, promptId, 'Apple SHARP + MoGe-2');

  report(options.onProgress, 45, 'Gaussian splat generation started');
  const historyItem = await waitForCompletion(promptId, clientId, options, {
    running: 'Reconstructing the 360° Gaussian environment',
    waiting: 'Apple SHARP and MoGe-2 are processing locally',
    timeoutMinutes: 60,
  });
  const outputFiles = extractOutputFiles(historyItem, options.apiBase);
  const gaussianFiles = outputFiles.filter((file) => file.extension === 'ply');

  report(options.onProgress, 100, 'Gaussian splat generation complete');
  return {
    promptId,
    outputFiles,
    history: historyItem,
    warning:
      gaussianFiles.length === 0
        ? 'The Gaussian workflow completed, but ComfyUI did not report a downloadable PLY file. Check Merge Gaussians node 54, Transform Gaussian node 78, and the Comfy Desktop output folder.'
        : undefined,
  };
}

export async function runStoryboardWorkflow(options: RunStoryboardWorkflowOptions): Promise<GenerationResult> {
  if (!options.preflightPassed) {
    report(options.onProgress, 5, 'Connecting to Comfy Desktop');
    await checkComfy(options.signal, options.apiBase);
    report(options.onProgress, 10, 'Checking SDXL storyboard and IPAdapter nodes');
    await checkStoryboardSupport(options.signal, options.apiBase);
  }

  report(options.onProgress, 15, 'Preparing storyboard look reference');
  const { blob, filename } = await sourceToBlob(options.sourceImage, options.sourceFilename, options.signal);

  report(options.onProgress, 25, 'Uploading storyboard look reference to ComfyUI');
  const uploaded = await uploadImage(blob, filename, options.signal, options.apiBase);

  report(options.onProgress, 35, 'Preparing the four-beat storyboard animatic');
  const template = await loadWorkflow(STORYBOARD_WORKFLOW_URL, 'four-beat storyboard animatic', options.signal);
  const workflow = patchStoryboardWorkflow(template, uploaded.name, options);

  const clientId = crypto.randomUUID();
  report(options.onProgress, 42, 'Adding storyboard animatic to the local queue');
  const promptId = await queueWorkflow(workflow, clientId, 'four-beat storyboard animatic', options.signal, options.apiBase, options.tag);
  options.onPromptId?.(promptId);
  emitGraph(options, workflow, promptId, 'SDXL + IPAdapter storyboard');

  report(options.onProgress, 45, 'Storyboard rendering started');
  const historyItem = await waitForCompletion(promptId, clientId, options, {
    running: 'Rendering the four storyboard frames',
    waiting: 'SDXL and IPAdapter are building the animatic locally',
    timeoutMinutes: 45,
  });
  const outputFiles = extractOutputFiles(historyItem, options.apiBase);
  const videoFiles = outputFiles.filter((file) => VIDEO_EXTENSIONS.has(file.extension));
  const totalOutputDurationSec = videoFiles[0]
    ? await readVideoDuration(videoFiles[0].url, options.signal).catch(() => (options.holdSeconds ?? 2) * 4)
    : undefined;

  report(options.onProgress, 100, 'Storyboard animatic complete');
  return {
    promptId,
    outputFiles,
    history: historyItem,
    totalOutputDurationSec,
    warning:
      videoFiles.length === 0
        ? 'The storyboard workflow completed, but ComfyUI did not report a downloadable MP4. Check Save Video node 30 and the Comfy Desktop output folder.'
        : undefined,
  };
}

export async function runTrellisWorkflow(options: RunTrellisWorkflowOptions): Promise<GenerationResult> {
  if (!options.preflightPassed) {
    report(options.onProgress, 5, 'Connecting to Comfy Desktop');
    await checkComfy(options.signal, options.apiBase);
    report(options.onProgress, 10, 'Checking dual GLB export support');
    await checkTexturedGlbSupport(options.signal, options.apiBase);
  }

  report(options.onProgress, 15, 'Preparing source image');
  const { blob, filename } = await sourceToBlob(options.sourceImage, options.sourceFilename, options.signal);

  report(options.onProgress, 25, 'Uploading image to ComfyUI');
  const uploaded = await uploadImage(blob, filename, options.signal, options.apiBase);

  report(options.onProgress, 35, 'Preparing TRELLIS.2 workflow');
  const template = await loadWorkflow(TRELLIS_WORKFLOW_URL, 'TRELLIS.2', options.signal);
  const workflow = patchTrellisWorkflow(
    template,
    uploaded.name,
    options.density ?? 'Ultra High',
    options.lowVram ?? true,
  );

  const clientId = crypto.randomUUID();
  report(options.onProgress, 42, 'Adding workflow to the local queue');
  const promptId = await queueWorkflow(workflow, clientId, 'TRELLIS.2', options.signal, options.apiBase, options.tag);
  options.onPromptId?.(promptId);
  emitGraph(options, workflow, promptId, 'TRELLIS.2 image-to-3D');

  report(options.onProgress, 45, 'TRELLIS.2 started');
  const historyItem = await waitForCompletion(promptId, clientId, options, {
    running: 'Generating the 3D asset',
    waiting: 'TRELLIS.2 is processing locally',
    timeoutMinutes: 30,
  });
  const outputFiles = extractOutputFiles(historyItem, options.apiBase);
  const glbFiles = outputFiles.filter((file) => file.extension === 'glb' || file.extension === 'gltf');

  report(options.onProgress, 100, '3D generation complete');
  return {
    promptId,
    outputFiles,
    history: historyItem,
    warning:
      glbFiles.length === 0
        ? 'The TRELLIS.2 workflow completed, but ComfyUI did not report a downloadable GLB/GLTF model. Check export nodes 99 and 101, the Comfy Desktop console, and the output folder.'
        : undefined,
  };
}

export async function runWanVideoWorkflow(options: RunWanVideoWorkflowOptions): Promise<GenerationResult> {
  if (!options.preflightPassed) {
    report(options.onProgress, 5, 'Connecting to Comfy Desktop');
    await checkComfy(options.signal, options.apiBase);
    report(options.onProgress, 10, 'Checking WAN 2.2 video nodes');
    await checkWanVideoSupport(options.signal, options.apiBase);
  }

  report(options.onProgress, 15, 'Preparing continuity frame');
  const { blob, filename } = await sourceToBlob(options.sourceImage, options.sourceFilename, options.signal);

  report(options.onProgress, 25, 'Uploading continuity frame to ComfyUI');
  const uploaded = await uploadImage(blob, filename, options.signal, options.apiBase);

  report(options.onProgress, 35, 'Preparing WAN 2.2 shot editor workflow');
  const template = await loadWorkflow(WAN_VIDEO_WORKFLOW_URL, 'WAN 2.2 shot editor workflow', options.signal);
  const workflow = patchWanVideoWorkflow(template, uploaded.name, options);

  const clientId = crypto.randomUUID();
  report(options.onProgress, 42, 'Adding video workflow to the local queue');
  const promptId = await queueWorkflow(workflow, clientId, 'WAN 2.2 shot editor workflow', options.signal, options.apiBase, options.tag);
  options.onPromptId?.(promptId);
  emitGraph(options, workflow, promptId, 'WAN 2.2 image-to-video');

  report(options.onProgress, 45, 'WAN 2.2 video generation started');
  const historyItem = await waitForCompletion(promptId, clientId, options, {
    running: 'Synthesizing the cinematic shot',
    waiting: 'WAN 2.2 is rendering locally',
    timeoutMinutes: 60,
  });
  const outputFiles = extractOutputFiles(historyItem, options.apiBase);
  const videoFiles = outputFiles.filter((file) => VIDEO_EXTENSIONS.has(file.extension));

  report(options.onProgress, 100, 'Cinematic video generation complete');
  return {
    promptId,
    outputFiles,
    history: historyItem,
    warning:
      videoFiles.length === 0
        ? 'The WAN 2.2 workflow completed, but ComfyUI did not report a downloadable video file. Check node 108 (Save Video), the ComfyUI output folder, and the Comfy Desktop console.'
        : undefined,
  };
}


function waitForMediaEvent(target: HTMLMediaElement, eventName: string, signal?: AbortSignal, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout = 0;
    const cleanup = () => {
      target.removeEventListener(eventName, handleSuccess);
      target.removeEventListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
      window.clearTimeout(timeout);
    };
    const handleSuccess = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('The generated shot could not be decoded for continuity.'));
    };
    const handleAbort = () => {
      cleanup();
      reject(new DOMException('Generation cancelled', 'AbortError'));
    };
    target.addEventListener(eventName, handleSuccess, { once: true });
    target.addEventListener('error', handleError, { once: true });
    signal?.addEventListener('abort', handleAbort, { once: true });
    timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while extracting the final continuity frame.'));
    }, timeoutMs);
  });
}

export async function readVideoDuration(videoUrl: string, signal?: AbortSignal): Promise<number> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = videoUrl;
  await waitForMediaEvent(video, 'loadedmetadata', signal);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  video.removeAttribute('src');
  video.load();
  if (duration <= 0) throw new Error('The generated video has no readable duration.');
  return Math.round(duration * 100) / 100;
}

export async function extractLastFrameAsDataUrl(videoUrl: string, signal?: AbortSignal): Promise<string> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = videoUrl;

  await waitForMediaEvent(video, 'loadedmetadata', signal);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('The generated shot has no readable duration, so continuity cannot continue.');
  }

  video.currentTime = Math.max(0, video.duration - Math.min(0.08, video.duration / 4));
  await waitForMediaEvent(video, 'seeked', signal);

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The generated shot has no readable video frame.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not prepare the continuity frame canvas.');
  context.drawImage(video, 0, 0, width, height);
  video.removeAttribute('src');
  video.load();
  return canvas.toDataURL('image/png', 0.95);
}

export function calculateMultiShotDuration(shots: Array<{ duration: number }>): number {
  return shots.reduce((total, shot) => total + Math.max(0, Number(shot.duration) || 0), 0);
}

export function getMultiShotDependencyIndex(shots: Array<{ referenceImage?: string }>, index: number): number | null {
  if (index <= 0 || index >= shots.length) return null;
  return shots[index]?.referenceImage ? null : index - 1;
}

export function getInitiallyParallelShotIndexes(shots: Array<{ referenceImage?: string }>): number[] {
  return shots.map((_, index) => index).filter((index) => getMultiShotDependencyIndex(shots, index) === null);
}

export async function runWanMultiShotWorkflow(options: RunWanMultiShotWorkflowOptions): Promise<GenerationResult> {
  if (options.shots.length < 1) throw new Error('The shot editor requires at least one scene.');
  if (options.shots.length > 12) throw new Error('The shot editor supports up to twelve scenes per sequence.');

  const startedAt = performance.now();
  const shotResults: ShotGenerationResult[] = [];
  const allOutputFiles: ComfyOutputFile[] = [];
  const histories: Record<string, unknown>[] = [];
  let continuityImage = options.sourceImage;
  let continuityFilename = options.sourceFilename;
  const baseSeed = Number.isFinite(options.seed) ? Math.max(0, Math.floor(options.seed as number)) : Math.floor(Math.random() * 2_147_483_000);

  for (let index = 0; index < options.shots.length; index += 1) {
    if (options.signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
    const shot = options.shots[index];
    const sectionStart = 10 + (index / options.shots.length) * 85;
    const sectionSize = 85 / options.shots.length;

    if (options.onAwaitShotStart) {
      report(options.onProgress, sectionStart, `Awaiting manual run for shot ${index + 1} of ${options.shots.length}: ${shot.title}`);
      await options.onAwaitShotStart({ index, totalShots: options.shots.length, shot });
      if (options.signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
    }

    const usingShotReference = Boolean(shot.referenceImage);
    const sourceImageForShot = shot.referenceImage || continuityImage;
    const sourceFilenameForShot = shot.referenceFilename || continuityFilename;
    report(
      options.onProgress,
      sectionStart,
      usingShotReference
        ? `Preparing shot ${index + 1} of ${options.shots.length}: ${shot.title} · using shot reference`
        : `Preparing shot ${index + 1} of ${options.shots.length}: ${shot.title}`,
    );

    const result = await runWanVideoWorkflow({
      sourceImage: sourceImageForShot,
      sourceFilename: sourceFilenameForShot,
      prompt: shot.prompt,
      negativePrompt: shot.negativePrompt,
      title: shot.title,
      duration: shot.duration,
      cameraMotion: shot.cameraMotion,
      focalLength: shot.focalLength,
      aspectRatio: options.aspectRatio,
      fps: options.fps,
      qualityMode: options.qualityMode,
      continuityMode: options.continuityMode,
      onGraph: options.onGraph,
      tag: {
        ...options.tag,
        workflow: 'shot',
        shotTitle: shot.title,
        shotIndex: index,
        totalShots: options.shots.length,
      },
      seed: baseSeed + index,
      sequenceIndex: index,
      signal: options.signal,
      preflightPassed: true,
      apiBase: options.apiBase,
      onPromptId: options.onPromptId,
      onProgress: (progress) => {
        const mapped = sectionStart + (progress.percent / 100) * sectionSize;
        report(options.onProgress, mapped, `Shot ${index + 1}/${options.shots.length} · ${progress.status}`, progress.nodeId);
      },
    });

    const videoFile = result.outputFiles.find((file) => VIDEO_EXTENSIONS.has(file.extension));
    if (!videoFile) {
      throw new Error(`Shot ${index + 1} completed without a downloadable video. The sequence stopped before the next continuity frame could be created.`);
    }

    const actualDurationSec = await readVideoDuration(videoFile.url, options.signal).catch(() => shot.duration);
    shotResults.push({
      index,
      title: shot.title,
      prompt: shot.prompt,
      negativePrompt: shot.negativePrompt,
      duration: shot.duration,
      actualDurationSec,
      promptId: result.promptId,
      outputFiles: result.outputFiles,
    });
    allOutputFiles.push(...result.outputFiles);
    histories.push(result.history);

    if (index < options.shots.length - 1) {
      report(options.onProgress, sectionStart + sectionSize * 0.94, `Extracting final frame from shot ${index + 1} for continuity`);
      continuityImage = await extractLastFrameAsDataUrl(videoFile.url, options.signal);
      continuityFilename = `dreamframe_sequence_continuity_${index + 1}.png`;
    }
  }

  const renderDurationMs = Math.round(performance.now() - startedAt);
  report(options.onProgress, 100, `${options.shots.length}-shot cinematic sequence complete`);
  return {
    promptId: shotResults[shotResults.length - 1]?.promptId || '',
    outputFiles: allOutputFiles,
    history: { shots: histories },
    shotResults,
    renderDurationMs,
    totalOutputDurationSec: Math.round(shotResults.reduce((total, shot) => total + (shot.actualDurationSec ?? shot.duration), 0) * 100) / 100,
  };
}


interface DistributedShotOutcome {
  status: DistributedShotStatus;
  result?: ShotGenerationResult;
  history?: Record<string, unknown>;
  continuityImage?: string;
  continuityFilename?: string;
  error?: string;
}

function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const valid = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of valid) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

export async function runWanDistributedMultiShotWorkflow(options: RunWanDistributedMultiShotWorkflowOptions): Promise<GenerationResult> {
  if (options.shots.length < 1) throw new Error('The distributed shot editor requires at least one scene.');
  if (options.shots.length > 12) throw new Error('The distributed shot editor supports up to twelve scenes per sequence.');
  const availableWorkers = options.workers.filter((worker) => worker.status !== 'offline');
  if (availableWorkers.length === 0) throw new Error('No online render PCs are available. Check dreamframe-workers.json and start ComfyUI on each machine.');

  const startedAt = performance.now();
  const baseSeed = Number.isFinite(options.seed) ? Math.max(0, Math.floor(options.seed as number)) : Math.floor(Math.random() * 2_147_483_000);
  const workerForShot = options.shots.map((shot, index) =>
    availableWorkers.find((worker) => worker.id === shot.workerId) || availableWorkers[index % availableWorkers.length],
  );
  const usedWorkers = Array.from(new Map(workerForShot.map((worker) => [worker.id, worker])).values());

  report(options.onProgress, 2, `Checking ${usedWorkers.length} render PC${usedWorkers.length === 1 ? '' : 's'}`);
  await Promise.all(usedWorkers.map((worker) => runWorkflowPreflight({
    workflow: 'shot',
    sourceImage: options.sourceImage,
    sourceFilename: options.sourceFilename,
    signal: options.signal,
    apiBase: worker.apiBase,
  })));
  report(options.onProgress, 10, 'Render PCs are ready');

  const shotPercents = new Map<number, number>();
  const updateShot = (update: DistributedShotUpdate) => {
    shotPercents.set(update.index, update.percent);
    options.onShotUpdate?.(update);
    const average = [...shotPercents.values()].reduce((total, value) => total + value, 0) / Math.max(1, options.shots.length);
    report(options.onProgress, Math.max(10, Math.min(99, 10 + average * 0.89)), update.message);
  };

  const taskMemo = new Map<number, Promise<DistributedShotOutcome>>();
  const runShot = (index: number): Promise<DistributedShotOutcome> => {
    const existing = taskMemo.get(index);
    if (existing) return existing;

    const promise = (async (): Promise<DistributedShotOutcome> => {
      const shot = options.shots[index];
      const worker = workerForShot[index];
      const dependencyIndex = getMultiShotDependencyIndex(options.shots, index);
      let sourceImage = shot.referenceImage || options.sourceImage;
      let sourceFilename = shot.referenceFilename || options.sourceFilename;

      if (dependencyIndex !== null) {
        updateShot({
          index,
          title: shot.title,
          workerId: worker.id,
          workerName: worker.name,
          status: 'blocked',
          percent: 0,
          message: `Shot ${index + 1} is waiting for shot ${dependencyIndex + 1}`,
        });
        const dependency = await runShot(dependencyIndex);
        if (dependency.status !== 'completed' || !dependency.continuityImage) {
          const message = `Shot ${index + 1} could not start because shot ${dependencyIndex + 1} did not complete.`;
          updateShot({ index, title: shot.title, workerId: worker.id, workerName: worker.name, status: 'cancelled', percent: 0, message });
          return { status: 'cancelled', error: message };
        }
        sourceImage = dependency.continuityImage;
        sourceFilename = dependency.continuityFilename;
      }

      const shotSignal = combineAbortSignals([options.signal, options.getShotSignal?.(index)]);
      try {
        updateShot({
          index,
          title: shot.title,
          workerId: worker.id,
          workerName: worker.name,
          status: 'ready',
          percent: 0,
          message: `Shot ${index + 1} is ready on ${worker.name}`,
        });
        await options.onAwaitShotStart?.({ index, totalShots: options.shots.length, shot, worker, dependencyIndex });
        if (shotSignal?.aborted) throw new DOMException('Shot cancelled', 'AbortError');

        updateShot({
          index,
          title: shot.title,
          workerId: worker.id,
          workerName: worker.name,
          status: 'running',
          percent: 1,
          message: `Shot ${index + 1} is rendering on ${worker.name}`,
        });

        const generation = await runWanVideoWorkflow({
          sourceImage,
          sourceFilename,
          prompt: shot.prompt,
          negativePrompt: shot.negativePrompt,
          title: shot.title,
          duration: shot.duration,
          cameraMotion: shot.cameraMotion,
          focalLength: shot.focalLength,
          aspectRatio: options.aspectRatio,
          fps: options.fps,
          qualityMode: options.qualityMode,
          continuityMode: options.continuityMode,
          onGraph: options.onGraph,
          tag: {
            ...options.tag,
            workflow: 'shot',
            shotTitle: shot.title,
            shotIndex: index,
            totalShots: options.shots.length,
          },
          seed: baseSeed + index,
          sequenceIndex: index,
          signal: shotSignal,
          preflightPassed: true,
          apiBase: worker.apiBase,
          onPromptId: (promptId) => {
            options.onShotPromptId?.(index, promptId, worker);
            updateShot({
              index,
              title: shot.title,
              workerId: worker.id,
              workerName: worker.name,
              status: 'running',
              percent: 8,
              promptId,
              message: `Shot ${index + 1} entered ${worker.name}'s queue`,
            });
          },
          onProgress: (progress) => updateShot({
            index,
            title: shot.title,
            workerId: worker.id,
            workerName: worker.name,
            status: 'running',
            percent: progress.percent,
            message: `Shot ${index + 1} · ${worker.name} · ${progress.status}`,
          }),
        });

        const videoFile = generation.outputFiles.find((file) => VIDEO_EXTENSIONS.has(file.extension));
        if (!videoFile) throw new Error(`Shot ${index + 1} completed without a downloadable video.`);
        const actualDurationSec = await readVideoDuration(videoFile.url, shotSignal).catch(() => shot.duration);
        const hasDependentShot = index + 1 < options.shots.length && !options.shots[index + 1].referenceImage;
        const continuityImage = hasDependentShot ? await extractLastFrameAsDataUrl(videoFile.url, shotSignal) : undefined;
        const result: ShotGenerationResult = {
          index,
          title: shot.title,
          prompt: shot.prompt,
          negativePrompt: shot.negativePrompt,
          duration: shot.duration,
          actualDurationSec,
          promptId: generation.promptId,
          outputFiles: generation.outputFiles,
          status: 'completed',
          workerId: worker.id,
          workerName: worker.name,
        };
        updateShot({
          index,
          title: shot.title,
          workerId: worker.id,
          workerName: worker.name,
          status: 'completed',
          percent: 100,
          promptId: generation.promptId,
          message: `Shot ${index + 1} completed on ${worker.name}`,
        });
        return {
          status: 'completed',
          result,
          history: generation.history,
          continuityImage,
          continuityFilename: continuityImage ? `dreamframe_distributed_continuity_${index + 1}.png` : undefined,
        };
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === 'AbortError';
        const message = cancelled ? `Shot ${index + 1} was cancelled.` : error instanceof Error ? error.message : `Shot ${index + 1} failed.`;
        updateShot({
          index,
          title: shot.title,
          workerId: worker.id,
          workerName: worker.name,
          status: cancelled ? 'cancelled' : 'failed',
          percent: 0,
          message,
          error: message,
        });
        return { status: cancelled ? 'cancelled' : 'failed', error: message };
      }
    })();
    taskMemo.set(index, promise);
    return promise;
  };

  const outcomes = await Promise.all(options.shots.map((_, index) => runShot(index)));
  if (options.signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
  const completed = outcomes
    .map((outcome) => outcome.result)
    .filter((result): result is ShotGenerationResult => Boolean(result))
    .sort((a, b) => a.index - b.index);
  const outputFiles = completed.flatMap((result) => result.outputFiles);
  const incompleteCount = options.shots.length - completed.length;
  const renderDurationMs = Math.round(performance.now() - startedAt);
  report(options.onProgress, 100, incompleteCount === 0 ? 'Distributed sequence complete' : `Distributed render finished with ${incompleteCount} incomplete shot${incompleteCount === 1 ? '' : 's'}`);

  return {
    promptId: completed[completed.length - 1]?.promptId || '',
    outputFiles,
    history: {
      distributed: true,
      workers: usedWorkers.map((worker) => ({ id: worker.id, name: worker.name })),
      shots: outcomes.map((outcome, index) => ({ index, status: outcome.status, history: outcome.history, error: outcome.error })),
    },
    shotResults: completed,
    renderDurationMs,
    totalOutputDurationSec: Math.round(completed.reduce((total, shot) => total + (shot.actualDurationSec ?? shot.duration), 0) * 100) / 100,
    warning: incompleteCount > 0 ? `${incompleteCount} shot${incompleteCount === 1 ? ' was' : 's were'} cancelled, blocked, or failed. Completed shots remain available in the output viewer.` : undefined,
  };
}

export async function checkOutputAvailability(url?: string): Promise<'unknown' | 'available' | 'offline' | 'missing'> {
  if (!url) return 'missing';
  if (url.startsWith('blob:') || url.startsWith('data:')) return 'available';
  try {
    let response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (response.status === 405) {
      response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    }
    if (response.ok || response.status === 206) return 'available';
    if (response.status === 404) return 'missing';
    return 'unknown';
  } catch {
    return 'offline';
  }
}

export async function interruptComfy(promptId?: string, apiBase = API_BASE): Promise<void> {
  const base = resolveApiBase(apiBase);
  const requests: Promise<unknown>[] = [
    fetch(`${base}/interrupt`, { method: 'POST' }),
  ];

  if (promptId) {
    const jsonHeaders = { 'Content-Type': 'application/json' };
    requests.push(
      fetch(`${base}/queue`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ delete: [promptId] }),
      }),
    );
    requests.push(
      fetch(`${base}/history`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ delete: [promptId] }),
      }),
    );
  }

  await Promise.allSettled(requests.map((request) => Promise.resolve(request).catch(() => undefined)));
}
