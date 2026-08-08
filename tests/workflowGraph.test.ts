import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  collectWeights,
  graphStats,
  isLink,
  linkType,
  nodeLines,
  placeGraph,
  textRoles,
  weightFileOf,
} from '../src/lib/workflowGraph';
import type { GraphJson, PostedGraph } from '../src/lib/workflowGraph';

/** Shaped like the real WAN template: prompts reach the sampler through WanImageToVideo. */
const wanGraph: GraphJson = {
  '1': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_i2v_high.safetensors' } },
  '2': { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl.safetensors', type: 'wan' } },
  '3': { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
  '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'a lighthouse at dawn' } },
  '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'blurry, static' } },
  '6': { class_type: 'LoadImage', inputs: { image: 'opening.png' } },
  '7': {
    class_type: 'WanImageToVideo',
    inputs: { positive: ['4', 0], negative: ['5', 0], vae: ['3', 0], start_image: ['6', 0], width: 832, height: 480, length: 81 },
  },
  '8': {
    class_type: 'KSampler',
    inputs: { model: ['1', 0], positive: ['7', 0], negative: ['7', 1], latent_image: ['7', 2], steps: 20, cfg: 3.5, sampler_name: 'euler', scheduler: 'simple', seed: 42 },
  },
  '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
  '10': { class_type: 'SaveVideo', inputs: { images: ['9', 0], filename_prefix: 'video/dreamframe', format: 'auto' } },
};

describe('link and category typing', () => {
  it('recognises a link tuple and nothing else', () => {
    expect(isLink(['4', 0])).toBe(true);
    expect(isLink([0, 4])).toBe(false);
    expect(isLink('4')).toBe(false);
    expect(isLink(['4', 0, 1])).toBe(false);
  });

  it('maps input names to ComfyUI link types, falling back rather than guessing', () => {
    expect(linkType('model')).toBe('MODEL');
    expect(linkType('positive')).toBe('COND');
    expect(linkType('start_image')).toBe('IMAGE');
    expect(linkType('some_unknown_input')).toBe('OTHER');
  });

  it('categorises DreamFrame’s own node vocabulary', () => {
    expect(categoryOf('UNETLoader')).toBe('loader');
    expect(categoryOf('LoraLoaderModelOnly')).toBe('patch');
    expect(categoryOf('Trellis2ImageToShape')).toBe('sample');
    expect(categoryOf('SaveVideo')).toBe('out');
    expect(categoryOf('SomeNodePackNode')).toBe('tool');
  });
});

describe('weightFileOf', () => {
  it('reads the named loader input', () => {
    expect(weightFileOf(wanGraph['1'])).toBe('wan2.2_i2v_high.safetensors');
    expect(weightFileOf(wanGraph['3'])).toBe('wan_2.1_vae.safetensors');
  });

  it('falls back to any input that looks like a weight file', () => {
    expect(weightFileOf({ class_type: 'LoadSharpModel', inputs: { ckpt: 'sharp_model.pth' } })).toBe('sharp_model.pth');
  });

  it('returns nothing when the node loads no weight', () => {
    expect(weightFileOf(wanGraph['9'])).toBeUndefined();
    expect(weightFileOf({ class_type: 'LoadImage', inputs: { image: 'opening.png' } })).toBeUndefined();
  });
});

describe('textRoles', () => {
  it('follows the positive side through WanImageToVideo instead of trusting node order', () => {
    const roles = textRoles(wanGraph);
    expect(roles['4']).toBe('positive');
    expect(roles['5']).toBe('negative');
  });
});

describe('nodeLines', () => {
  it('states the sampler schedule and seed', () => {
    expect(nodeLines(wanGraph['8']).map((line) => line.text)).toEqual([
      'steps 20 · cfg 3.5',
      'euler / simple',
      'seed 42',
    ]);
  });

  it('keeps the whole prompt for the tooltip while clipping the drawn line', () => {
    const long = { class_type: 'CLIPTextEncode', inputs: { text: 'a'.repeat(80) } };
    const [line] = nodeLines(long);
    expect(line.text.length).toBeLessThanOrEqual(24);
    expect(line.full).toHaveLength(80);
  });

  it('describes the video canvas and length', () => {
    expect(nodeLines(wanGraph['7']).map((line) => line.text)).toEqual(['832 × 480', 'length 81']);
  });

  it('falls back to a node’s own scalars when it has no hand-written line', () => {
    const lines = nodeLines({ class_type: 'PanoramaSplitAdaptive', inputs: { overlap: 32, faces: 6, image: ['1', 0] } });
    expect(lines.map((line) => line.text)).toEqual(['overlap 32', 'faces 6']);
  });
});

describe('placeGraph', () => {
  it('puts parentless loaders in the first column and the sink last', () => {
    const laid = placeGraph(wanGraph);
    const columnOf = (id: string) => laid.nodes[id].x;
    const first = Math.min(...Object.values(laid.nodes).map((node) => node.x));
    expect(columnOf('1')).toBe(first);
    expect(columnOf('2')).toBe(first);
    expect(columnOf('10')).toBeGreaterThan(columnOf('8'));
    expect(columnOf('8')).toBeGreaterThan(columnOf('7'));
  });

  it('lays out every node exactly once', () => {
    const laid = placeGraph(wanGraph);
    expect(Object.keys(laid.nodes).sort()).toEqual(Object.keys(wanGraph).sort());
  });

  it('survives a cycle rather than recursing forever', () => {
    const cyclic: GraphJson = {
      a: { class_type: 'KSampler', inputs: { model: ['b', 0] } },
      b: { class_type: 'KSampler', inputs: { model: ['a', 0] } },
    };
    expect(() => placeGraph(cyclic)).not.toThrow();
  });

  it('handles an empty graph', () => {
    const laid = placeGraph({});
    expect(laid.nodes).toEqual({});
  });
});

describe('graphStats and collectWeights', () => {
  it('counts nodes and links', () => {
    expect(graphStats(wanGraph)).toEqual({ nodes: 10, links: 13 });
  });

  it('gathers weights across graphs, counting repeat loads once per node', () => {
    const posted = (promptId: string): PostedGraph => ({
      promptId,
      label: promptId,
      engine: 'WAN 2.2 image-to-video',
      graph: wanGraph,
    });
    const weights = collectWeights([posted('a'), posted('b')]);

    expect(weights.map((weight) => weight.file).sort()).toEqual([
      'umt5_xxl.safetensors',
      'wan2.2_i2v_high.safetensors',
      'wan_2.1_vae.safetensors',
    ]);
    expect(weights.every((weight) => weight.loads === 2)).toBe(true);
    expect(weights.find((weight) => weight.file === 'wan_2.1_vae.safetensors')?.usedBy).toEqual(['VAELoader']);
  });

  it('reports no weights for a graph that names none', () => {
    expect(collectWeights([{ promptId: 'x', label: 'x', engine: 'x', graph: { '1': wanGraph['9'] } }])).toEqual([]);
  });
});
