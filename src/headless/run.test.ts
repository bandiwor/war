import { describe, expect, it } from 'vitest';
import { seed } from '../domain/core/brand';
import { runHeadless } from './run';

describe('headless run', () => {
  it('is deterministic with and without input', () => {
    expect(runHeadless(seed(3), 500, true)).toEqual(runHeadless(seed(3), 500, true));
    expect(runHeadless(seed(3), 500, true).hash).not.toBe(runHeadless(seed(3), 500, false).hash);
  });
});
