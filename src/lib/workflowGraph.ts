/**
 * The graph layer behind the Workflow tab. DreamFrame posts its prompts as API-format JSON,
 * so what is drawn here is the object that was sent — not a redrawing of it. Layout, link
 * typing and parameter extraction are pure so they can be tested without a browser.
 */

export interface GraphNode {
  class_type: string;
  inputs: Record<string, any>;
}

export type GraphJson = Record<string, GraphNode>;

export interface PostedGraph {
  promptId: string;
  label: string;
  engine: string;
  shotIndex?: number;
  workerName?: string;
  apiBase?: string;
  graph: GraphJson;
}

/** ComfyUI's own link colours — anyone who has opened the engine reads these without a key. */
export const LINK_COLOR: Record<string, string> = {
  MODEL: '#b39ddb',
  CLIP: '#ffd500',
  VAE: '#ff6e6e',
  COND: '#ffa931',
  LATENT: '#ff9cf9',
  IMAGE: '#64b5f6',
  MESH: '#7ee787',
  OTHER: '#8b93a7',
};

const LINK_OF: Record<string, string> = {
  model: 'MODEL',
  clip: 'CLIP',
  vae: 'VAE',
  positive: 'COND',
  negative: 'COND',
  conditioning: 'COND',
  latent_image: 'LATENT',
  samples: 'LATENT',
  image: 'IMAGE',
  images: 'IMAGE',
  image1: 'IMAGE',
  image2: 'IMAGE',
  start_image: 'IMAGE',
  reference_image: 'IMAGE',
  pixels: 'IMAGE',
  mask: 'IMAGE',
  mesh: 'MESH',
  trimesh: 'MESH',
  gaussians: 'MESH',
};

const CATEGORY: Record<string, string> = {
  UNETLoader: 'loader',
  CLIPLoader: 'loader',
  VAELoader: 'loader',
  CheckpointLoaderSimple: 'loader',
  LoadImage: 'loader',
  IPAdapterUnifiedLoader: 'loader',
  LoadTrellis2Models: 'loader',
  LoadSharpModel: 'loader',
  DownloadAndLoadMoGe2Model: 'loader',
  ModelSamplingSD3: 'patch',
  LoraLoaderModelOnly: 'patch',
  IPAdapter: 'patch',
  CLIPTextEncode: 'encode',
  Trellis2GetConditioning: 'encode',
  EmptyLatentImage: 'latent',
  WanImageToVideo: 'latent',
  KSampler: 'sample',
  KSamplerAdvanced: 'sample',
  Trellis2ImageToShape: 'sample',
  SharpPredictGaussiansFromMetricDepth: 'sample',
  MoGe2Inference: 'sample',
  VAEDecode: 'decode',
  Trellis2ShapeToTexturedMesh: 'decode',
  Trellis2RasterizePBR: 'decode',
  SaveVideo: 'out',
  CreateVideo: 'out',
  Trellis2ExportTrimesh: 'out',
  PreviewImage: 'out',
  Preview3D: 'out',
  PreviewGaussians: 'out',
  MaskPreview: 'out',
  GeomPackPreviewMeshVTK: 'out',
};

const FILE_INPUT: Record<string, string> = {
  UNETLoader: 'unet_name',
  CLIPLoader: 'clip_name',
  VAELoader: 'vae_name',
  CheckpointLoaderSimple: 'ckpt_name',
  LoraLoaderModelOnly: 'lora_name',
  DownloadAndLoadMoGe2Model: 'model',
};

const WEIGHT_EXTENSIONS = ['.safetensors', '.gguf', '.pth', '.ckpt', '.bin', '.pt', '.sft'];

export const isLink = (value: any): value is [string, number] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

export function linkType(inputName: string): string {
  return LINK_OF[inputName] || 'OTHER';
}

export function categoryOf(classType: string): string {
  return CATEGORY[classType] || 'tool';
}

/** The weight a node loads: named input first, then any string that looks like a model file. */
export function weightFileOf(node: GraphNode): string | undefined {
  const named = FILE_INPUT[node.class_type];
  if (named && typeof node.inputs?.[named] === 'string') return node.inputs[named];
  for (const value of Object.values(node.inputs ?? {})) {
    if (typeof value !== 'string') continue;
    const lower = value.toLowerCase();
    if (WEIGHT_EXTENSIONS.some((extension) => lower.endsWith(extension))) return value;
  }
  return undefined;
}

/**
 * Which text encoder feeds the positive side, followed through the graph rather than guessed
 * by node order — WAN reaches its prompts through WanImageToVideo, not directly.
 */
export function textRoles(graph: GraphJson): Record<string, 'positive' | 'negative'> {
  const role: Record<string, 'positive' | 'negative'> = {};
  const walk = (id: string, side: 'positive' | 'negative', depth: number) => {
    const node = graph[id];
    if (!node || depth > 4) return;
    if (/TextEncode/.test(node.class_type)) {
      if (!role[id]) role[id] = side;
      return;
    }
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if ((name === 'positive' || name === 'negative') && isLink(value)) walk(value[0], name, depth + 1);
    }
  };
  for (const node of Object.values(graph)) {
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if ((name === 'positive' || name === 'negative') && isLink(value)) walk(value[0], name, 0);
    }
  }
  return role;
}

export interface ParamLine {
  text: string;
  full?: string;
}

const clip = (value: string, at = 24) => (value.length > at ? `${value.slice(0, at - 1)}…` : value);

export function nodeLines(node: GraphNode): ParamLine[] {
  const inputs = node.inputs ?? {};
  const out: ParamLine[] = [];
  const put = (text: string, full?: string) => out.push({ text, full });
  const scalar = (name: string) => (isLink(inputs[name]) ? undefined : inputs[name]);

  switch (node.class_type) {
    case 'CLIPTextEncode': {
      const text = String(scalar('text') ?? '');
      put(clip(text) || '—', text || undefined);
      break;
    }
    case 'KSampler':
      put(`steps ${inputs.steps} · cfg ${inputs.cfg}`);
      put(`${inputs.sampler_name} / ${inputs.scheduler}`);
      if (scalar('seed') != null) put(`seed ${inputs.seed}`);
      break;
    case 'KSamplerAdvanced':
      put(`steps ${inputs.start_at_step} → ${Number(inputs.end_at_step) > 999 ? 'end' : inputs.end_at_step}`);
      put(`cfg ${inputs.cfg} · noise ${inputs.add_noise}`);
      if (scalar('noise_seed') != null) put(`seed ${inputs.noise_seed}`);
      break;
    case 'ModelSamplingSD3':
      put(`shift ${inputs.shift}`);
      break;
    case 'LoraLoaderModelOnly':
      put(clip(String(inputs.lora_name ?? '').replace(/\.safetensors$/, '')), String(inputs.lora_name ?? ''));
      put(`strength ${inputs.strength_model}`);
      break;
    case 'EmptyLatentImage':
      put(`${inputs.width} × ${inputs.height}`);
      if (Number(inputs.batch_size) > 1) put(`batch ${inputs.batch_size}`);
      break;
    case 'WanImageToVideo':
      put(`${inputs.width} × ${inputs.height}`);
      put(`length ${inputs.length}`);
      break;
    case 'CLIPLoader':
      put(`type ${inputs.type}`);
      break;
    case 'CreateVideo':
      put(`${inputs.fps} fps`);
      break;
    case 'SaveVideo':
      put(clip(String(inputs.filename_prefix ?? '')), String(inputs.filename_prefix ?? ''));
      if (inputs.format) put(`${inputs.format} · ${inputs.codec ?? 'auto'}`);
      break;
    case 'LoadImage':
      put(clip(String(inputs.image ?? '')), String(inputs.image ?? ''));
      break;
    case 'RepeatImageBatch':
      put(`×${inputs.amount}`);
      break;
    case 'IPAdapter':
      put(`weight ${inputs.weight}`);
      if (inputs.weight_type) put(String(inputs.weight_type));
      break;
    case 'IPAdapterUnifiedLoader':
      put(String(inputs.preset ?? ''));
      break;
    case 'PrimitiveInt':
    case 'PrimitiveFloat':
    case 'PrimitiveBoolean':
      put(`value ${inputs.value}`);
      break;
    case 'ComfyMathExpression':
      put(clip(String(inputs.expression ?? '')), String(inputs.expression ?? ''));
      break;
    default: {
      // Anything without a hand-written line still shows its own scalars rather than nothing.
      const scalars = Object.entries(inputs)
        .filter(([, value]) => !isLink(value) && (typeof value === 'number' || typeof value === 'boolean'))
        .slice(0, 2);
      scalars.forEach(([name, value]) => put(`${name} ${value}`));
      break;
    }
  }
  return out;
}

export interface PlacedNode {
  id: string;
  classType: string;
  category: string;
  x: number;
  y: number;
  height: number;
  rows: ParamLine[];
  file?: string;
}

export interface PlacedGraph {
  nodes: Record<string, PlacedNode>;
  width: number;
  height: number;
  offset: number;
}

export const NODE_WIDTH = 158;
const COLUMN_GAP = 38;
const PAD = 16;
/** One canvas width for every graph, so a small graph and a large one draw nodes the same size. */
const CANVAS = 1386;

export function placeGraph(graph: GraphJson): PlacedGraph {
  const ids = Object.keys(graph);
  if (ids.length === 0) return { nodes: {}, width: CANVAS, height: 80, offset: 0 };

  const parentsOf = (id: string): string[] =>
    Object.values(graph[id]?.inputs ?? {}).filter(isLink).map((value) => value[0]);

  const depth: Record<string, number> = {};
  const measure = (id: string, guard: number): number => {
    if (depth[id] !== undefined) return depth[id];
    if (guard > 32 || !graph[id]) return 0;
    depth[id] = 0;
    const parents = parentsOf(id).filter((parent) => graph[parent]);
    depth[id] = parents.length ? 1 + Math.max(...parents.map((parent) => measure(parent, guard + 1))) : 0;
    return depth[id];
  };
  ids.forEach((id) => measure(id, 0));

  const nodes: Record<string, PlacedNode> = {};
  ids.forEach((id) => {
    const node = graph[id];
    const rows = nodeLines(node);
    const file = weightFileOf(node);
    nodes[id] = {
      id,
      classType: node.class_type,
      category: categoryOf(node.class_type),
      x: 0,
      y: 0,
      rows,
      file,
      height: 30 + 13 * Math.max(rows.length, 1) + (file ? 22 : 0),
    };
  });

  const columnCount = Math.max(...ids.map((id) => depth[id])) + 1;
  const columns: string[][] = [];
  for (let index = 0; index < columnCount; index += 1) {
    columns.push(ids.filter((id) => depth[id] === index));
  }

  // Order each column by the mean row of its parents, so the links stay short.
  const row: Record<string, number> = {};
  const meanParent = (id: string) => {
    const parents = parentsOf(id).filter((parent) => row[parent] !== undefined);
    if (!parents.length) return 0;
    return parents.reduce((sum, parent) => sum + row[parent], 0) / parents.length;
  };
  columns.forEach((column, index) => {
    if (index > 0) column.sort((a, b) => meanParent(a) - meanParent(b));
    column.forEach((id, rowIndex) => {
      row[id] = rowIndex;
    });
  });

  const pitch = Math.max(...Object.values(nodes).map((node) => node.height)) + 22;
  const tallest = Math.max(...columns.map((column) => column.length));
  columns.forEach((column, index) => {
    let y = PAD + ((tallest - column.length) * pitch) / 2;
    column.forEach((id) => {
      nodes[id].x = PAD + index * (NODE_WIDTH + COLUMN_GAP);
      nodes[id].y = y;
      y += pitch;
    });
  });

  const width = PAD * 2 + columnCount * NODE_WIDTH + (columnCount - 1) * COLUMN_GAP;
  const bottom = Math.max(...Object.values(nodes).map((node) => node.y + node.height));
  return {
    nodes,
    width: Math.max(CANVAS, width),
    offset: Math.max(0, (CANVAS - width) / 2),
    height: bottom + PAD,
  };
}

export interface GraphStats {
  nodes: number;
  links: number;
}

export function graphStats(graph: GraphJson): GraphStats {
  const nodes = Object.keys(graph).length;
  const links = Object.values(graph).reduce(
    (sum, node) => sum + Object.values(node.inputs ?? {}).filter(isLink).length,
    0,
  );
  return { nodes, links };
}

export interface WeightUsage {
  file: string;
  role: string;
  loads: number;
  usedBy: string[];
}

/**
 * Every weight file the posted graphs name. File sizes are deliberately absent: reading them
 * means reading the models folder off disk, which a browser cannot do.
 */
export function collectWeights(graphs: PostedGraph[]): WeightUsage[] {
  const byFile = new Map<string, WeightUsage>();
  for (const posted of graphs) {
    for (const node of Object.values(posted.graph)) {
      const file = weightFileOf(node);
      if (!file) continue;
      const bare = file.replace(/\\/g, '/').split('/').pop() || file;
      const existing = byFile.get(bare);
      if (existing) {
        existing.loads += 1;
        if (!existing.usedBy.includes(node.class_type)) existing.usedBy.push(node.class_type);
      } else {
        byFile.set(bare, {
          file: bare,
          role: categoryOf(node.class_type) === 'patch' ? 'lora' : 'model',
          loads: 1,
          usedBy: [node.class_type],
        });
      }
    }
  }
  return [...byFile.values()].sort((a, b) => b.loads - a.loads || a.file.localeCompare(b.file));
}
