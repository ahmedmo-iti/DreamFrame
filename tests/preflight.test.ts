import { describe, expect, it } from 'vitest';
import {
  isApproximatelyTwoToOne,
  parseOpenExrDimensions,
  parseRadianceHdrDimensions,
  validateWorkflowSource,
} from '../src/lib/preflight';

function createMinimalExrDataWindow(width: number, height: number): ArrayBuffer {
  const encoder = new TextEncoder();
  const name = encoder.encode('dataWindow\0');
  const type = encoder.encode('box2i\0');
  const total = 8 + name.length + type.length + 4 + 16 + 1;
  const buffer = new ArrayBuffer(total);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  view.setUint32(0, 0x762f3101, true);
  view.setUint32(4, 2, true);
  let offset = 8;
  bytes.set(name, offset);
  offset += name.length;
  bytes.set(type, offset);
  offset += type.length;
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  view.setInt32(offset + 4, 0, true);
  view.setInt32(offset + 8, width - 1, true);
  view.setInt32(offset + 12, height - 1, true);
  bytes[offset + 16] = 0;
  return buffer;
}

describe('panorama validation', () => {
  it('accepts a 2:1 equirectangular panorama', () => {
    expect(isApproximatelyTwoToOne(4096, 2048)).toBe(true);
  });

  it('rejects a square image for Gaussian Splatting', () => {
    const issues = validateWorkflowSource({
      workflow: '3d',
      sourceImage: 'data:image/png;base64,test',
      sourceFilename: 'square.png',
      dimensions: { width: 1024, height: 1024 },
    });
    expect(issues.join(' ')).toContain('2:1 equirectangular');
  });

  it('reads Radiance HDR resolution headers', () => {
    const hdr = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2048 +X 4096\n').buffer;
    expect(parseRadianceHdrDimensions(hdr)).toEqual({ width: 4096, height: 2048 });
  });

  it('reads OpenEXR dataWindow dimensions', () => {
    expect(parseOpenExrDimensions(createMinimalExrDataWindow(4096, 2048))).toEqual({ width: 4096, height: 2048 });
  });

  it('rejects the disabled HDRI workflow', () => {
    const issues = validateWorkflowSource({
      workflow: 'hdri',
      sourceImage: 'data:image/png;base64,test',
      sourceFilename: 'sky.png',
    });
    expect(issues[0]).toContain('disabled');
  });
});
