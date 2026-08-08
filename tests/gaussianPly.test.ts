import { describe, expect, it } from 'vitest';
import { parseGaussianPly } from '../src/lib/gaussianPly';

function asciiPly() {
  const source = [
    'ply',
    'format ascii 1.0',
    'element vertex 2',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header',
    '0 0 0 255 0 0 1 -4 -4 -4 1 0 0 0',
    '1 0 0 0 255 0 0.5 -4 -4 -4 1 0 0 0',
  ].join('\n');
  return new TextEncoder().encode(source).buffer;
}

describe('Gaussian PLY parser', () => {
  it('reads anisotropic Gaussian properties into render buffers', () => {
    const cloud = parseGaussianPly(asciiPly(), 100);
    expect(cloud.sourceCount).toBe(2);
    expect(cloud.renderedCount).toBe(2);
    expect(cloud.positions).toHaveLength(6);
    expect(cloud.scales).toHaveLength(6);
    expect(cloud.rotations).toHaveLength(8);
    expect(cloud.colors[0]).toBeCloseTo(1);
    expect(cloud.colors[4]).toBeCloseTo(1);
    expect(cloud.opacities[1]).toBeCloseTo(0.5);
  });
});
