import { EditTool, TOOL_NODES, VIDEO_NODES } from './editGraphs';

/**
 * What this ComfyUI can actually run. Each tool is gated on its node classes existing and on a
 * matching weight being present in the loader's own enum, so a tool that cannot work says which
 * pack or file is missing instead of failing at dispatch.
 */

export interface FileRequirement {
  key: keyof ResolvedFiles;
  nodeClass: string;
  input: string;
  pattern: RegExp;
  label: string;
}

export interface ResolvedFiles {
  vace?: string;
  textEncoder?: string;
  wanVae?: string;
  sd15?: string;
  icLight?: string;
  upscale?: string;
}

export const FILE_REQUIREMENTS: FileRequirement[] = [
  { key: 'vace', nodeClass: 'UnetLoaderGGUF', input: 'unet_name', pattern: /vace/i, label: 'a Wan VACE model' },
  { key: 'textEncoder', nodeClass: 'CLIPLoader', input: 'clip_name', pattern: /umt5/i, label: 'the umt5 text encoder' },
  { key: 'wanVae', nodeClass: 'VAELoader', input: 'vae_name', pattern: /wan.*vae/i, label: 'the Wan VAE' },
  { key: 'sd15', nodeClass: 'CheckpointLoaderSimple', input: 'ckpt_name', pattern: /realistic|sd15|v1-5/i, label: 'an SD1.5 checkpoint' },
  { key: 'icLight', nodeClass: 'LoadAndApplyICLightUnet', input: 'model_path', pattern: /iclight/i, label: 'the IC-Light model' },
  { key: 'upscale', nodeClass: 'UpscaleModelLoader', input: 'model_name', pattern: /./, label: 'an upscale model' },
];

const TOOL_FILES: Record<EditTool, Array<keyof ResolvedFiles>> = {
  background: ['vace', 'textEncoder', 'wanVae'],
  replace: ['vace', 'textEncoder', 'wanVae'],
  remove: ['vace', 'textEncoder', 'wanVae'],
  inpaint: ['vace', 'textEncoder', 'wanVae'],
  style: ['vace', 'textEncoder', 'wanVae'],
  relight: ['sd15', 'icLight'],
  upscale: ['upscale'],
  facelock: [],
};

export interface EditCapability {
  tool: EditTool;
  ok: boolean;
  missingNodes: string[];
  missingFiles: string[];
}

export interface EditEnvironment {
  probed: boolean;
  online: boolean;
  capabilities: EditCapability[];
  files: ResolvedFiles;
  /** Present when the source is a video: VideoHelperSuite is only needed on that path. */
  videoNodesPresent: boolean;
  segmentReady: boolean;
  error?: string;
}

export const EMPTY_ENVIRONMENT: EditEnvironment = {
  probed: false,
  online: false,
  capabilities: [],
  files: {},
  videoNodesPresent: false,
  segmentReady: false,
};

interface ClassInfo {
  present: boolean;
  options: Record<string, string[]>;
}

/**
 * ComfyUI describes an enum input in two shapes, and a live server emits both at once:
 * custom nodes still send [[...choices], {meta}], while core nodes now send
 * ["COMBO", {options: [...]}]. Reading only the first shape hides every core node's file list,
 * which reports a tool as missing its weights on a machine that has them.
 */
export function readChoices(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];
  const isString = (value: unknown): value is string => typeof value === 'string';
  if (Array.isArray(spec[0])) return spec[0].filter(isString);
  if (spec[0] === 'COMBO') {
    const meta = spec[1] as { options?: unknown } | undefined;
    if (Array.isArray(meta?.options)) return meta.options.filter(isString);
  }
  return [];
}

async function probeClass(apiBase: string, nodeClass: string, signal?: AbortSignal): Promise<ClassInfo> {
  try {
    const response = await fetch(`${apiBase}/object_info/${encodeURIComponent(nodeClass)}`, {
      signal,
      cache: 'no-store',
    });
    if (!response.ok) return { present: false, options: {} };
    const payload = await response.json();
    const entry = payload?.[nodeClass];
    if (!entry) return { present: false, options: {} };

    const options: Record<string, string[]> = {};
    const required = entry?.input?.required ?? {};
    for (const [name, spec] of Object.entries(required)) {
      options[name] = readChoices(spec);
    }
    return { present: true, options };
  } catch {
    return { present: false, options: {} };
  }
}

export async function probeEditEnvironment(apiBase: string, signal?: AbortSignal): Promise<EditEnvironment> {
  const wanted = new Set<string>([...VIDEO_NODES]);
  for (const classes of Object.values(TOOL_NODES)) classes.forEach((name) => wanted.add(name));
  FILE_REQUIREMENTS.forEach((requirement) => wanted.add(requirement.nodeClass));

  const names = [...wanted];
  let reachable = false;
  const infos = new Map<string, ClassInfo>();
  for (const name of names) {
    const info = await probeClass(apiBase, name, signal);
    if (info.present) reachable = true;
    infos.set(name, info);
  }

  if (!reachable) {
    return {
      ...EMPTY_ENVIRONMENT,
      probed: true,
      error: 'No render PC answered, so the editing tools cannot be checked against it.',
    };
  }

  const files: ResolvedFiles = {};
  for (const requirement of FILE_REQUIREMENTS) {
    const info = infos.get(requirement.nodeClass);
    if (!info?.present) continue;
    const choices = info.options[requirement.input] ?? [];
    const match = choices.find((choice) => requirement.pattern.test(choice));
    if (match) files[requirement.key] = match;
  }

  const capabilities: EditCapability[] = (Object.keys(TOOL_NODES) as Array<EditTool | 'segment'>)
    .filter((tool): tool is EditTool => tool !== 'segment')
    .map((tool) => {
      const missingNodes = TOOL_NODES[tool].filter((name) => !infos.get(name)?.present);
      const missingFiles = TOOL_FILES[tool]
        .filter((key) => !files[key])
        .map((key) => FILE_REQUIREMENTS.find((requirement) => requirement.key === key)?.label || key);
      return { tool, ok: missingNodes.length === 0 && missingFiles.length === 0, missingNodes, missingFiles };
    });

  return {
    probed: true,
    online: true,
    capabilities,
    files,
    videoNodesPresent: VIDEO_NODES.every((name) => infos.get(name)?.present),
    segmentReady: TOOL_NODES.segment.every((name) => infos.get(name)?.present),
  };
}

export function capabilityOf(environment: EditEnvironment, tool: EditTool): EditCapability | undefined {
  return environment.capabilities.find((capability) => capability.tool === tool);
}

/** One sentence naming what is missing, for the gating footer. */
export function blockedReason(
  environment: EditEnvironment,
  tool: EditTool,
  needsVideo: boolean,
): string | null {
  if (!environment.probed) return 'Checking what this render PC can do…';
  if (!environment.online) return environment.error || 'No render PC answered.';
  const capability = capabilityOf(environment, tool);
  if (!capability) return 'This tool is not available.';
  if (capability.missingNodes.length > 0) {
    return `Needs ${capability.missingNodes.join(', ')} — install the node pack that provides it and restart ComfyUI.`;
  }
  if (capability.missingFiles.length > 0) {
    return `Needs ${capability.missingFiles.join(' and ')} in your ComfyUI models folder.`;
  }
  if (needsVideo && !environment.videoNodesPresent) {
    return 'Editing a video needs VideoHelperSuite (VHS_LoadVideo, VHS_VideoCombine). A still image can be edited without it.';
  }
  return null;
}
