import { describe, expect, it } from 'vitest';
import {
  buildFaceLock,
  buildRelight,
  buildSam2Image,
  buildUpscale,
  buildVaceEdit,
} from '../src/lib/editGraphs';
import type { GraphJson } from '../src/lib/workflowGraph';
import { blockedReason, EditEnvironment, readChoices } from '../src/lib/editCapabilities';

const findNode = (graph: GraphJson, classType: string) =>
  Object.values(graph).find((node) => node.class_type === classType);

const classes = (graph: GraphJson) => Object.values(graph).map((node) => node.class_type);

const vaceBase = {
  sourceName: 'shot.png',
  isVideo: false,
  prompt: 'a misty pine forest at dawn',
  width: 832,
  height: 480,
  length: 1,
  vaceModel: 'Wan2.1_14B_VACE-Q4_K_M.gguf',
  textEncoder: 'umt5_xxl.safetensors',
  vae: 'wan_2.1_vae.safetensors',
  seed: 7,
};

describe('buildVaceEdit', () => {
  it('wires the VACE core and names the models it was given', () => {
    const graph = buildVaceEdit(vaceBase);
    expect(findNode(graph, 'UnetLoaderGGUF')?.inputs.unet_name).toBe('Wan2.1_14B_VACE-Q4_K_M.gguf');
    expect(findNode(graph, 'CLIPLoader')?.inputs.clip_name).toBe('umt5_xxl.safetensors');
    expect(findNode(graph, 'VAELoader')?.inputs.vae_name).toBe('wan_2.1_vae.safetensors');
    expect(findNode(graph, 'KSampler')?.inputs.seed).toBe(7);
  });

  it('reads a still with LoadImage and writes it with SaveImage', () => {
    const graph = buildVaceEdit(vaceBase);
    expect(classes(graph)).toContain('LoadImage');
    expect(classes(graph)).toContain('SaveImage');
    expect(classes(graph)).not.toContain('VHS_LoadVideo');
  });

  it('reads a video through VideoHelperSuite and writes it back as video', () => {
    const graph = buildVaceEdit({ ...vaceBase, isVideo: true, length: 81, fps: 24 });
    expect(classes(graph)).toContain('VHS_LoadVideo');
    expect(findNode(graph, 'VHS_VideoCombine')?.inputs.frame_rate).toBe(24);
    expect(classes(graph)).not.toContain('SaveImage');
  });

  // VHS_LoadVideo lists these as required; omitting them is a 400 from ComfyUI, not a warning.
  it('gives the video loader every input it requires', () => {
    for (const graph of [
      buildVaceEdit({ ...vaceBase, isVideo: true, length: 81 }),
      buildUpscale({ sourceName: 'a.mp4', isVideo: true, model: '4x-UltraSharp.pth' }),
      buildFaceLock({ sourceName: 'a.mp4', isVideo: true, faceImageName: 'f.png' }),
    ]) {
      const loader = findNode(graph, 'VHS_LoadVideo');
      expect(loader).toBeDefined();
      for (const input of ['video', 'force_rate', 'custom_width', 'custom_height', 'frame_load_cap', 'skip_first_frames', 'select_every_nth']) {
        expect(loader?.inputs).toHaveProperty(input);
      }
    }
  });

  it('carries no mask or composite when none was selected', () => {
    const graph = buildVaceEdit(vaceBase);
    expect(findNode(graph, 'WanVaceToVideo')?.inputs.control_masks).toBeUndefined();
    expect(classes(graph)).not.toContain('ImageCompositeMasked');
    expect(classes(graph)).not.toContain('InvertMask');
  });

  it('composites everything outside the mask back from the source', () => {
    const graph = buildVaceEdit({ ...vaceBase, maskName: 'mask.png' });
    expect(findNode(graph, 'WanVaceToVideo')?.inputs.control_masks).toBeDefined();
    expect(classes(graph)).toContain('InvertMask');

    const composite = findNode(graph, 'ImageCompositeMasked');
    expect(composite).toBeDefined();
    const sourceLink = composite?.inputs.source as [string, number];
    expect(graph[sourceLink[0]].class_type).toBe('LoadImage');
    const destinationLink = composite?.inputs.destination as [string, number];
    expect(graph[destinationLink[0]].class_type).toBe('VAEDecode');
  });

  it('can be told to leave the outside alone', () => {
    const graph = buildVaceEdit({ ...vaceBase, maskName: 'mask.png', compositeOutside: false });
    expect(classes(graph)).not.toContain('ImageCompositeMasked');
  });

  it('passes strength through to the VACE node', () => {
    const graph = buildVaceEdit({ ...vaceBase, strength: 0.55 });
    expect(findNode(graph, 'WanVaceToVideo')?.inputs.strength).toBe(0.55);
  });
});

describe('buildSam2Image', () => {
  it('splits clicked points into keep and exclude lists', () => {
    const graph = buildSam2Image({
      imageName: 'shot.png',
      points: [
        { x: 10.4, y: 20.6, positive: true },
        { x: 90, y: 30, positive: false },
      ],
    });
    const segmentation = findNode(graph, 'Sam2Segmentation');
    expect(JSON.parse(segmentation?.inputs.coordinates_positive)).toEqual([{ x: 10, y: 21 }]);
    expect(JSON.parse(segmentation?.inputs.coordinates_negative)).toEqual([{ x: 90, y: 30 }]);
  });

  it('omits the exclude list entirely when nothing was excluded', () => {
    const graph = buildSam2Image({ imageName: 'shot.png', points: [{ x: 1, y: 2, positive: true }] });
    expect(findNode(graph, 'Sam2Segmentation')?.inputs.coordinates_negative).toBeUndefined();
  });

  it('saves the mask as an image the player can overlay', () => {
    const graph = buildSam2Image({ imageName: 'shot.png', points: [{ x: 1, y: 2, positive: true }] });
    expect(classes(graph)).toContain('MaskToImage');
    expect(findNode(graph, 'SaveImage')?.inputs.filename_prefix).toBe('dreamframe/mask');
  });
});

describe('the remaining tools', () => {
  it('relight conditions IC-Light on the encoded foreground', () => {
    const graph = buildRelight({
      imageName: 'shot.png',
      prompt: 'warm golden hour light',
      width: 832,
      height: 480,
      checkpoint: 'realisticVision.safetensors',
      icLightModel: 'iclight_sd15_fc.safetensors',
    });
    expect(findNode(graph, 'LoadAndApplyICLightUnet')?.inputs.model_path).toBe('iclight_sd15_fc.safetensors');
    const conditioning = findNode(graph, 'ICLightConditioning');
    const foreground = conditioning?.inputs.foreground as [string, number];
    expect(graph[foreground[0]].class_type).toBe('VAEEncode');
  });

  it('upscale runs the image through the named model', () => {
    const graph = buildUpscale({ sourceName: 'shot.png', isVideo: false, model: '4x-UltraSharp.pth' });
    expect(findNode(graph, 'UpscaleModelLoader')?.inputs.model_name).toBe('4x-UltraSharp.pth');
    expect(classes(graph)).toContain('ImageUpscaleWithModel');
  });

  it('face lock feeds the reference face as the swap source', () => {
    const graph = buildFaceLock({ sourceName: 'clip.mp4', isVideo: true, faceImageName: 'face.png' });
    const swap = findNode(graph, 'ReActorFaceSwap');
    const sourceLink = swap?.inputs.source_image as [string, number];
    expect(graph[sourceLink[0]].inputs.image).toBe('face.png');
    expect(classes(graph)).toContain('VHS_VideoCombine');
  });
});

describe('readChoices', () => {
  // A live ComfyUI emits both shapes at once: custom nodes use the legacy array, core nodes COMBO.
  it('reads the legacy [[choices], meta] shape used by custom nodes', () => {
    expect(readChoices([['a.safetensors', 'b.gguf'], { tooltip: 'x' }])).toEqual(['a.safetensors', 'b.gguf']);
  });

  it('reads the COMBO shape used by core nodes', () => {
    expect(readChoices(['COMBO', { multiselect: false, options: ['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth'] }]))
      .toEqual(['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth']);
  });

  it('returns nothing for a plain scalar input', () => {
    expect(readChoices(['INT', { default: 20 }])).toEqual([]);
    expect(readChoices('STRING')).toEqual([]);
    expect(readChoices(undefined)).toEqual([]);
  });
});

describe('blockedReason', () => {
  const ready: EditEnvironment = {
    probed: true,
    online: true,
    videoNodesPresent: true,
    segmentReady: true,
    files: { vace: 'v.gguf', textEncoder: 'umt5.safetensors', wanVae: 'wan.safetensors' },
    capabilities: [
      { tool: 'style', ok: true, missingNodes: [], missingFiles: [] },
      { tool: 'relight', ok: false, missingNodes: ['LoadAndApplyICLightUnet'], missingFiles: [] },
      { tool: 'upscale', ok: false, missingNodes: [], missingFiles: ['an upscale model'] },
    ],
  };

  it('says nothing when the tool can run', () => {
    expect(blockedReason(ready, 'style', false)).toBeNull();
  });

  it('names the missing node class', () => {
    expect(blockedReason(ready, 'relight', false)).toContain('LoadAndApplyICLightUnet');
  });

  it('names the missing weight file', () => {
    expect(blockedReason(ready, 'upscale', false)).toContain('an upscale model');
  });

  it('only demands VideoHelperSuite when the source is a video', () => {
    const noVideo = { ...ready, videoNodesPresent: false };
    expect(blockedReason(noVideo, 'style', false)).toBeNull();
    expect(blockedReason(noVideo, 'style', true)).toContain('VideoHelperSuite');
  });

  it('reports the probe state before it has run', () => {
    expect(blockedReason({ ...ready, probed: false }, 'style', false)).toContain('Checking');
    expect(blockedReason({ ...ready, online: false, error: 'nope' }, 'style', false)).toBe('nope');
  });
});
