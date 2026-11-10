import { describe, expect, it } from 'vitest';
import {
  EFFECT_IDS,
  isEffectId,
  POST_EFFECTS,
  PostFxConfigSchema,
  clonePostFx,
  defaultPostFx,
  effectSpec,
  getEffectParam,
  setEffectParam,
} from './effects';
import { applyWeatherToPostFx, createStimulus, modulatePostFx } from './stimulus';

describe('post effect registry', () => {
  it('lists every effect once, sorted by order, with sane param specs', () => {
    expect(new Set(EFFECT_IDS).size).toBe(Object.keys(POST_EFFECTS).length);
    // Orders are unique, so the chain order never depends on sort stability.
    expect(new Set(EFFECT_IDS.map((id) => effectSpec(id).order)).size).toBe(EFFECT_IDS.length);
    for (let i = 1; i < EFFECT_IDS.length; i++) {
      const a = EFFECT_IDS[i - 1];
      const b = EFFECT_IDS[i];
      if (a === undefined || b === undefined) throw new Error('index');
      expect(effectSpec(a).order).toBeLessThanOrEqual(effectSpec(b).order);
    }
    for (const id of EFFECT_IDS) {
      for (const s of Object.values(effectSpec(id).params)) {
        expect(s.min).toBeLessThan(s.max);
        expect(s.default).toBeGreaterThanOrEqual(s.min);
        expect(s.default).toBeLessThanOrEqual(s.max);
        expect(s.step).toBeGreaterThan(0);
      }
    }
  });

  it('defaults validate; out-of-range or unknown params are rejected', () => {
    const cfg = defaultPostFx();
    expect(PostFxConfigSchema.safeParse(cfg).success).toBe(true);
    expect(
      PostFxConfigSchema.safeParse({
        ...cfg,
        vignette: { enabled: true, params: { amount: 99, softness: 0.5 } },
      }).success,
    ).toBe(false);
    expect(
      PostFxConfigSchema.safeParse({
        ...cfg,
        vignette: { enabled: true, params: { amount: 0.5, softness: 0.5, extra: 1 } },
      }).success,
    ).toBe(false);
    expect(
      PostFxConfigSchema.safeParse({ ...cfg, sparkles: { enabled: true, params: {} } }).success,
    ).toBe(false);
  });

  it('isEffectId', () => {
    expect(isEffectId('bloom')).toBe(true);
    expect(isEffectId('toString')).toBe(false);
  });

  it('set/get params generically with clamping', () => {
    const cfg = defaultPostFx();
    expect(setEffectParam(cfg, 'grain', 'amount', 5)).toBe(true);
    expect(getEffectParam(cfg, 'grain', 'amount')).toBe(POST_EFFECTS.grain.params.amount.max);
    expect(setEffectParam(cfg, 'grain', 'nope', 1)).toBe(false);
    expect(getEffectParam(cfg, 'grain', 'nope')).toBeUndefined();
  });

  it('clone is deep', () => {
    const a = defaultPostFx();
    a.bloom.enabled = false;
    a.bloom.params.intensity = 2;
    const b = clonePostFx(a);
    expect(b.bloom).toEqual({ enabled: false, params: { ...a.bloom.params } });
    b.bloom.params.intensity = 1;
    expect(a.bloom.params.intensity).toBe(2);
  });
});

describe('stimulus modulation', () => {
  it('is identity at zero stimulus', () => {
    const base = defaultPostFx();
    expect(modulatePostFx(base, createStimulus(), clonePostFx(base))).toEqual(base);
  });

  it('damage, fear and emi push the look in the documented directions', () => {
    const base = defaultPostFx();
    const out = clonePostFx(base);
    modulatePostFx(base, { damage: 1, fear: 0, emi: 0 }, out);
    expect(out.chromaticAberration.params.amount).toBeGreaterThan(
      base.chromaticAberration.params.amount,
    );
    expect(out.signalLoss.params.ratePerMinute).toBeGreaterThan(
      base.signalLoss.params.ratePerMinute,
    );
    modulatePostFx(base, { damage: 0, fear: 1, emi: 0 }, out);
    expect(out.vignette.params.amount).toBeGreaterThan(base.vignette.params.amount);
    expect(out.cameraShake.params.breathing).toBeGreaterThan(base.cameraShake.params.breathing);
    modulatePostFx(base, { damage: 0, fear: 0, emi: 5 }, out); // clamped to 1
    expect(out.compression.params.base).toBeCloseTo(base.compression.params.base + 0.6);
    expect(out.signalLoss.params.ratePerMinute).toBeCloseTo(
      base.signalLoss.params.ratePerMinute + 40,
    );
  });
});

describe('weather on the lens', () => {
  it('rain adds droplets on top of the configured amount, capped at 1', () => {
    const base = defaultPostFx();
    const out = defaultPostFx();
    expect(applyWeatherToPostFx(base, 0, out).lensDirt.params.droplets).toBe(
      base.lensDirt.params.droplets,
    );
    expect(applyWeatherToPostFx(base, 0.5, out).lensDirt.params.droplets).toBeGreaterThan(
      base.lensDirt.params.droplets,
    );
    expect(applyWeatherToPostFx(base, 9, out).lensDirt.params.droplets).toBe(1);
    expect(out.lensDirt.enabled).toBe(base.lensDirt.enabled);
  });
});
