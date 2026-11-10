import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeListener } from './audio-engine';

/** Firefox-style listener: no AudioParams, only the legacy methods. */
function legacyListener() {
  return {
    setPosition: vi.fn<(x: number, y: number, z: number) => void>(),
    setOrientation: vi.fn<(...v: number[]) => void>(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('placeListener', () => {
  it('falls back to setPosition/setOrientation where the listener has no AudioParams (Firefox)', () => {
    const l = legacyListener();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test double for the browser AudioListener
    placeListener(l as unknown as AudioListener, 0, 1, 2, 3, 0);
    expect(l.setPosition).toHaveBeenCalledWith(1, 2, 3);
    const orientation = l.setOrientation.mock.calls[0] ?? [];
    expect(orientation.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, 0, -1, 0, 1, 0]);
  });

  it('uses the AudioParams where they exist (Chrome, Safari)', () => {
    class FakeParam {
      value = 0;
      setValueAtTime = vi.fn((v: number) => {
        this.value = v;
      });
    }
    vi.stubGlobal('AudioParam', FakeParam);
    const names = [
      'positionX',
      'positionY',
      'positionZ',
      'forwardX',
      'forwardY',
      'forwardZ',
      'upX',
      'upY',
      'upZ',
    ];
    const l: Record<string, unknown> = { setPosition: vi.fn(), setOrientation: vi.fn() };
    for (const n of names) l[n] = new FakeParam();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test double for the browser AudioListener
    placeListener(l as unknown as AudioListener, 0.5, 4, 5, 6, Math.PI / 2);
    const v = (n: string): number => {
      const p = l[n];
      return p instanceof FakeParam ? p.value : NaN;
    };
    expect([v('positionX'), v('positionY'), v('positionZ')]).toEqual([4, 5, 6]);
    expect(v('forwardX')).toBeCloseTo(-1);
    expect(v('upY')).toBe(1);
    expect(l['setPosition']).not.toHaveBeenCalled();
  });
});
