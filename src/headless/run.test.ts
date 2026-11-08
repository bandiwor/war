import { describe, expect, it } from 'vitest';
import { seed } from '../domain/core/brand';
import { runHeadless } from './run';

describe('headless run', () => {
  it('is deterministic with and without input', async () => {
    expect(await runHeadless(seed(3), 500, true)).toEqual(await runHeadless(seed(3), 500, true));
    expect((await runHeadless(seed(3), 500, true)).hash).not.toBe(
      (await runHeadless(seed(3), 500, false)).hash,
    );
  });

  it('runs the physics sandbox deterministically', async () => {
    const a = await runHeadless(seed(4), 600, true, 'sandbox');
    expect(await runHeadless(seed(4), 600, true, 'sandbox')).toEqual(a);
  });
});
