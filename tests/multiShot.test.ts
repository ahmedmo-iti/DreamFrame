import { describe, expect, it } from 'vitest';
import { calculateMultiShotDuration, getInitiallyParallelShotIndexes, getMultiShotDependencyIndex } from '../src/lib/comfyApi';

const shots = [
  { duration: 3 },
  { duration: 5 },
  { duration: 5 },
];

describe('multi-shot sequence planning', () => {
  it('calculates the real output duration from every shot', () => {
    expect(calculateMultiShotDuration(shots)).toBe(13);
  });

  it('does not allow negative durations to reduce the sequence length', () => {
    expect(calculateMultiShotDuration([{ duration: 5 }, { duration: -3 }])).toBe(5);
  });
});


describe('multi-PC shot dependencies', () => {
  const planned = [
    { referenceImage: '' },
    { referenceImage: 'data:image/png;base64,shot-two' },
    { referenceImage: '' },
    { referenceImage: 'data:image/png;base64,shot-four' },
  ];

  it('lets the opening shot and referenced shots start in parallel', () => {
    expect(getInitiallyParallelShotIndexes(planned)).toEqual([0, 1, 3]);
  });

  it('keeps an unreferenced later shot dependent on the previous shot', () => {
    expect(getMultiShotDependencyIndex(planned, 2)).toBe(1);
  });
});
