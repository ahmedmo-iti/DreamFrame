import { describe, expect, it } from 'vitest';
import { classifyAssetFile, getPrimaryOutputFile, humanFileSize, parseHumanFileSize } from '../src/lib/assetUtils';

describe('asset classification', () => {
  it('classifies HDR panoramas for Gaussian Splatting', () => {
    expect(classifyAssetFile({ name: 'studio_panorama.hdr', type: 'image/vnd.radiance' })).toMatchObject({
      category: '3d',
      workflowTarget: '3d',
      previewKind: 'file',
      canUseAsInput: true,
    });
  });

  it('keeps video uploads as source files rather than workflow outputs', () => {
    expect(classifyAssetFile({ name: 'plate.mp4', type: 'video/mp4' })).toMatchObject({
      category: 'shot',
      previewKind: 'video',
      canUseAsInput: false,
    });
  });


  it('treats non-Gaussian PLY files as 3D files without reviving the removed mesh workflow', () => {
    expect(classifyAssetFile({ name: 'character_scan.ply', type: 'application/octet-stream' })).toMatchObject({
      category: 'model',
      previewKind: 'model',
      canUseAsInput: false,
    });
  });

  it('selects the transformed Gaussian PLY as the primary output', () => {
    const files = [
      { filename: 'merged.ply', extension: 'ply', url: '/a', subfolder: '', type: 'output' as const },
      { filename: 'transformed_scene.ply', extension: 'ply', url: '/b', subfolder: '', type: 'output' as const },
    ];
    expect(getPrimaryOutputFile('3d', files)?.url).toBe('/b');
  });
});

describe('file sizes', () => {
  it('round trips common file sizes', () => {
    const label = humanFileSize(5 * 1024 * 1024);
    expect(label).toBe('5.0 MB');
    expect(parseHumanFileSize(label)).toBe(5 * 1024 * 1024);
  });
});
