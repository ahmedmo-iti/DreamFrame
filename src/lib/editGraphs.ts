import type { GraphJson } from './workflowGraph';

/**
 * Edit graphs, built in the browser and posted to ComfyUI as API-format JSON.
 *
 * These mirror DreamFrame's recipes, with one structural difference: DreamFrame extracts a
 * video to a frames directory with ffmpeg first and feeds VHS_LoadImagesPath. A browser has
 * no ffmpeg, so the video is uploaded whole and read by VHS_LoadVideo instead — which is why
 * the video tools carry a VideoHelperSuite dependency the image tools do not.
 */

export type EditTool =
  | 'background'
  | 'replace'
  | 'remove'
  | 'inpaint'
  | 'relight'
  | 'style'
  | 'upscale'
  | 'facelock';

export interface EditPoint {
  x: number;
  y: number;
  /** false marks "not this" — Alt-click in the player. */
  positive: boolean;
}

type Slot = [string, number];

interface NodeRef {
  id: string;
  out: (slot?: number) => Slot;
}

class GraphBuilder {
  private nodes: GraphJson = {};

  private nextId = 1;

  add(classType: string, inputs: Record<string, any>): NodeRef {
    const id = String(this.nextId);
    this.nextId += 1;
    this.nodes[id] = { class_type: classType, inputs };
    return { id, out: (slot = 0) => [id, slot] as Slot };
  }

  compile(): GraphJson {
    return this.nodes;
  }
}

export function pickSeed(seed?: number): number {
  if (seed == null || seed < 0) return Math.floor(Math.random() * 2 ** 48);
  return Math.floor(seed);
}

function pointsJson(points: EditPoint[], want: boolean): string {
  return JSON.stringify(
    points.filter((point) => point.positive === want).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
  );
}

function encodePair(graph: GraphBuilder, clip: Slot, positive: string, negative: string) {
  return {
    positive: graph.add('CLIPTextEncode', { clip, text: positive }),
    negative: graph.add('CLIPTextEncode', { clip, text: negative }),
  };
}

/** Every node class a tool needs before it can be offered. */
export const TOOL_NODES: Record<EditTool | 'segment', string[]> = {
  segment: ['DownloadAndLoadSAM2Model', 'Sam2Segmentation', 'MaskToImage'],
  background: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'WanVaceToVideo', 'ModelSamplingSD3'],
  replace: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'WanVaceToVideo', 'ModelSamplingSD3'],
  remove: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'WanVaceToVideo', 'ModelSamplingSD3'],
  inpaint: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'WanVaceToVideo', 'ModelSamplingSD3'],
  style: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'WanVaceToVideo', 'ModelSamplingSD3'],
  relight: ['CheckpointLoaderSimple', 'LoadAndApplyICLightUnet', 'ICLightConditioning', 'VAEEncode'],
  upscale: ['UpscaleModelLoader', 'ImageUpscaleWithModel'],
  facelock: ['ReActorFaceSwap'],
};

/** Extra classes needed only when the tool is pointed at a video rather than a still. */
export const VIDEO_NODES = ['VHS_LoadVideo', 'VHS_VideoCombine'];

export const DEFAULT_NEGATIVE =
  'blurry, low quality, deformed, distorted, watermark, text, extra limbs, warped face';

export interface VaceEditOptions {
  sourceName: string;
  isVideo: boolean;
  prompt: string;
  negative?: string;
  width: number;
  height: number;
  length: number;
  fps?: number;
  maskName?: string;
  strength?: number;
  compositeOutside?: boolean;
  steps?: number;
  cfg?: number;
  seed?: number;
  vaceModel: string;
  textEncoder: string;
  vae: string;
  prefix?: string;
}

/**
 * The masked edit: background, replace, remove, inpaint and restyle are all this graph with a
 * different prompt and mask. Everything outside the mask is composited back from the source,
 * so untouched pixels stay bit-identical rather than being re-synthesised.
 */
export function buildVaceEdit(options: VaceEditOptions): GraphJson {
  const g = new GraphBuilder();
  const unet = g.add('UnetLoaderGGUF', { unet_name: options.vaceModel });
  const model = g.add('ModelSamplingSD3', { model: unet.out(), shift: 8.0 });
  const clip = g.add('CLIPLoader', { clip_name: options.textEncoder, type: 'wan', device: 'default' });
  const vae = g.add('VAELoader', { vae_name: options.vae });
  const text = encodePair(g, clip.out(), options.prompt, options.negative ?? DEFAULT_NEGATIVE);

  const source = options.isVideo
    ? g.add('VHS_LoadVideo', {
        video: options.sourceName,
        force_rate: 0,
        force_size: 'Disabled',
        // 0 is this node's "disable" value on both: keep the source resolution.
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: options.length,
        skip_first_frames: 0,
        select_every_nth: 1,
      })
    : g.add('LoadImage', { image: options.sourceName });

  const vaceInputs: Record<string, any> = {
    positive: text.positive.out(),
    negative: text.negative.out(),
    vae: vae.out(),
    width: options.width,
    height: options.height,
    length: options.length,
    batch_size: 1,
    strength: options.strength ?? 0.85,
    control_video: source.out(),
  };

  let maskRef: NodeRef | undefined;
  if (options.maskName) {
    const maskImage = g.add('LoadImage', { image: options.maskName });
    maskRef = g.add('ImageToMask', { image: maskImage.out(), channel: 'red' });
    vaceInputs.control_masks = maskRef.out();
  }

  const vace = g.add('WanVaceToVideo', vaceInputs);
  const sampled = g.add('KSampler', {
    model: model.out(),
    seed: pickSeed(options.seed),
    steps: options.steps ?? 20,
    cfg: options.cfg ?? 3.5,
    sampler_name: 'uni_pc',
    scheduler: 'simple',
    positive: vace.out(0),
    negative: vace.out(1),
    latent_image: vace.out(2),
    denoise: 1.0,
  });
  const decoded = g.add('VAEDecode', { samples: sampled.out(), vae: vae.out() });

  let output = decoded.out();
  if (maskRef && (options.compositeOutside ?? true)) {
    const inverted = g.add('InvertMask', { mask: maskRef.out() });
    const composited = g.add('ImageCompositeMasked', {
      destination: decoded.out(),
      source: source.out(),
      mask: inverted.out(),
      x: 0,
      y: 0,
      resize_source: false,
    });
    output = composited.out();
  }

  const prefix = options.prefix ?? 'dreamframe/edit';
  if (options.isVideo) {
    g.add('VHS_VideoCombine', {
      images: output,
      frame_rate: options.fps ?? 24,
      loop_count: 0,
      filename_prefix: prefix,
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    });
  } else {
    g.add('SaveImage', { images: output, filename_prefix: prefix });
  }
  return g.compile();
}

export interface Sam2Options {
  imageName: string;
  points: EditPoint[];
  model?: string;
  prefix?: string;
}

/** Click-to-select: the points become a mask image the player can draw over the frame. */
export function buildSam2Image(options: Sam2Options): GraphJson {
  const g = new GraphBuilder();
  const loader = g.add('DownloadAndLoadSAM2Model', {
    model: options.model ?? 'sam2_hiera_base_plus.safetensors',
    segmentor: 'single_image',
    device: 'cuda',
    precision: 'fp16',
  });
  const image = g.add('LoadImage', { image: options.imageName });
  const inputs: Record<string, any> = {
    sam2_model: loader.out(),
    image: image.out(),
    keep_model_loaded: false,
    individual_objects: false,
    coordinates_positive: pointsJson(options.points, true),
  };
  const negative = pointsJson(options.points, false);
  if (negative !== '[]') inputs.coordinates_negative = negative;

  const segmentation = g.add('Sam2Segmentation', inputs);
  const maskImage = g.add('MaskToImage', { mask: segmentation.out() });
  g.add('SaveImage', { images: maskImage.out(), filename_prefix: options.prefix ?? 'dreamframe/mask' });
  return g.compile();
}

export interface RelightOptions {
  imageName: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  checkpoint: string;
  icLightModel: string;
  prefix?: string;
}

export function buildRelight(options: RelightOptions): GraphJson {
  const g = new GraphBuilder();
  const ckpt = g.add('CheckpointLoaderSimple', { ckpt_name: options.checkpoint });
  const ic = g.add('LoadAndApplyICLightUnet', { model: ckpt.out(0), model_path: options.icLightModel });
  const image = g.add('LoadImage', { image: options.imageName });
  const scaled = g.add('ImageScale', {
    image: image.out(),
    upscale_method: 'lanczos',
    width: options.width,
    height: options.height,
    crop: 'center',
  });
  const foreground = g.add('VAEEncode', { pixels: scaled.out(), vae: ckpt.out(2) });
  const text = encodePair(
    g,
    ckpt.out(1),
    options.prompt,
    'text, watermark, low quality, deformed, extra light sources, harsh artifacts',
  );
  const conditioned = g.add('ICLightConditioning', {
    positive: text.positive.out(),
    negative: text.negative.out(),
    vae: ckpt.out(2),
    foreground: foreground.out(),
    multiplier: 0.18215,
  });
  const latent = g.add('EmptyLatentImage', { width: options.width, height: options.height, batch_size: 1 });
  const sampled = g.add('KSampler', {
    model: ic.out(),
    seed: pickSeed(options.seed),
    steps: options.steps ?? 25,
    cfg: options.cfg ?? 2.0,
    sampler_name: 'dpmpp_2m',
    scheduler: 'karras',
    positive: conditioned.out(0),
    negative: conditioned.out(1),
    latent_image: latent.out(),
    denoise: 1.0,
  });
  const decoded = g.add('VAEDecode', { samples: sampled.out(), vae: ckpt.out(2) });
  g.add('SaveImage', { images: decoded.out(), filename_prefix: options.prefix ?? 'dreamframe/relight' });
  return g.compile();
}

export interface UpscaleOptions {
  sourceName: string;
  isVideo: boolean;
  model: string;
  length?: number;
  fps?: number;
  prefix?: string;
}

export function buildUpscale(options: UpscaleOptions): GraphJson {
  const g = new GraphBuilder();
  const upscaleModel = g.add('UpscaleModelLoader', { model_name: options.model });
  const source = options.isVideo
    ? g.add('VHS_LoadVideo', {
        video: options.sourceName,
        force_rate: 0,
        force_size: 'Disabled',
        // 0 is this node's "disable" value on both: keep the source resolution.
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: options.length ?? 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      })
    : g.add('LoadImage', { image: options.sourceName });
  const upscaled = g.add('ImageUpscaleWithModel', { upscale_model: upscaleModel.out(), image: source.out() });

  const prefix = options.prefix ?? 'dreamframe/upscale';
  if (options.isVideo) {
    g.add('VHS_VideoCombine', {
      images: upscaled.out(),
      frame_rate: options.fps ?? 24,
      loop_count: 0,
      filename_prefix: prefix,
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    });
  } else {
    g.add('SaveImage', { images: upscaled.out(), filename_prefix: prefix });
  }
  return g.compile();
}

export interface FaceLockOptions {
  sourceName: string;
  isVideo: boolean;
  faceImageName: string;
  restoreModel?: string;
  visibility?: number;
  length?: number;
  fps?: number;
  prefix?: string;
}

export function buildFaceLock(options: FaceLockOptions): GraphJson {
  const g = new GraphBuilder();
  const source = options.isVideo
    ? g.add('VHS_LoadVideo', {
        video: options.sourceName,
        force_rate: 0,
        force_size: 'Disabled',
        // 0 is this node's "disable" value on both: keep the source resolution.
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: options.length ?? 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      })
    : g.add('LoadImage', { image: options.sourceName });
  const face = g.add('LoadImage', { image: options.faceImageName });
  const swapped = g.add('ReActorFaceSwap', {
    enabled: true,
    input_image: source.out(),
    source_image: face.out(),
    swap_model: 'inswapper_128.onnx',
    facedetection: 'retinaface_resnet50',
    face_restore_model: options.restoreModel ?? 'GFPGANv1.4.pth',
    face_restore_visibility: options.visibility ?? 1.0,
    codeformer_weight: 0.5,
    detect_gender_input: 'no',
    detect_gender_source: 'no',
    input_faces_index: '0',
    source_faces_index: '0',
    console_log_level: 1,
  });

  const prefix = options.prefix ?? 'dreamframe/facelock';
  if (options.isVideo) {
    g.add('VHS_VideoCombine', {
      images: swapped.out(),
      frame_rate: options.fps ?? 24,
      loop_count: 0,
      filename_prefix: prefix,
      format: 'video/h264-mp4',
      pingpong: false,
      save_output: true,
    });
  } else {
    g.add('SaveImage', { images: swapped.out(), filename_prefix: prefix });
  }
  return g.compile();
}
