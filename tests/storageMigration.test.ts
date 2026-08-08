import { describe, expect, it } from 'vitest';
import { migrateLegacyLibraryState } from '../src/lib/storage';

describe('library migration', () => {
  it('separates legacy generated outputs from source assets', () => {
    const migrated = migrateLegacyLibraryState({
      assets: [
        { id: 'source', title: 'Reference', category: 'model', format: 'PNG', isGenerated: false },
        { id: 'output', title: 'Model', category: 'model', format: 'GLB', isGenerated: true, downloadUrl: '/comfy/view?file=model.glb' },
      ],
      projects: [],
      savedAt: 123,
    });

    expect(migrated?.version).toBe(2);
    expect(migrated?.assets[0].kind).toBe('source');
    expect(migrated?.assets[1].kind).toBe('output');
    expect(migrated?.assets[1].outputAvailability).toBe('unknown');
  });
});
