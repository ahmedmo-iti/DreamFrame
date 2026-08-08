import { parseGaussianPly } from '../../lib/gaussianPly';

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; maxSplats: number }>) => {
  try {
    const parsed = parseGaussianPly(event.data.buffer, event.data.maxSplats);
    (self as any).postMessage(
      { ok: true, parsed },
      [
        parsed.positions.buffer,
        parsed.colors.buffer,
        parsed.opacities.buffer,
        parsed.scales.buffer,
        parsed.rotations.buffer,
      ],
    );
  } catch (error) {
    (self as any).postMessage({ ok: false, error: error instanceof Error ? error.message : 'Gaussian parsing failed.' });
  }
};
