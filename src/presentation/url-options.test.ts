import { describe, expect, it } from 'vitest';
import { defaultPostFx } from '../domain/bodycam/effects';
import { applyFxSelection, parseUrlOptions, unknownEffects } from './url-options';

describe('url options', () => {
  it('defaults', () => {
    const o = parseUrlOptions('');
    expect(o).toMatchObject({
      seed: 1337,
      quality: 'medium',
      fx: 'all',
      frozenTime: undefined,
      preTicks: 0,
      walk: false,
      signal: 0,
      stimulus: null,
    });
  });

  it('touch screens get the phone controls and low quality unless the URL says otherwise', () => {
    expect(parseUrlOptions('', true)).toMatchObject({ touch: true, quality: 'low' });
    expect(parseUrlOptions('?quality=high', true)).toMatchObject({ touch: true, quality: 'high' });
    expect(parseUrlOptions('?touch=0', true)).toMatchObject({ touch: false, quality: 'medium' });
    expect(parseUrlOptions('?touch=1')).toMatchObject({ touch: true, quality: 'low' });
    expect(parseUrlOptions('').touch).toBe(false);
  });

  it('parses everything', () => {
    const o = parseUrlOptions(
      '?seed=42&quality=low&fx=bloom,vignette,nope&vt=3.5&ticks=90&look=0.5,-0.1&walk=1&signal=0.7&bench=15&stim=damage:0.5,emi:1,bogus:3',
    );
    expect(o.seed).toBe(42);
    expect(o.quality).toBe('low');
    expect(o.fx).toEqual(['bloom', 'vignette', 'nope']);
    expect(unknownEffects(o.fx)).toEqual(['nope']);
    expect(o.frozenTime).toBe(3.5);
    expect(o.preTicks).toBe(90);
    expect(o.look).toEqual([0.5, -0.1]);
    expect(o.walk).toBe(true);
    expect(o.benchSeconds).toBe(15);
    expect(o.replay).toBeNull();
    expect(parseUrlOptions('?replay=session').replay).toBe('session');
    expect(parseUrlOptions('').scene).toBe('world');
    expect(parseUrlOptions('?scene=street').scene).toBe('street');
    expect(parseUrlOptions('?scene=bogus').scene).toBe('world');
    expect(parseUrlOptions('?scene=range').scene).toBe('range');
    expect(o.signal).toBe(0.7);
    expect(o.stimulus).toEqual({ damage: 0.5, fear: 0, emi: 1 });
    expect(parseUrlOptions('?quality=ultra&seed=abc').quality).toBe('medium');
  });

  it('applies fx selections', () => {
    const cfg = defaultPostFx();
    applyFxSelection(cfg, 'none');
    expect(Object.values(cfg).some((e) => e.enabled)).toBe(false);
    applyFxSelection(cfg, ['grain']);
    expect(cfg.grain.enabled).toBe(true);
    expect(cfg.bloom.enabled).toBe(false);
    applyFxSelection(cfg, 'all');
    expect(Object.values(cfg).every((e) => e.enabled)).toBe(true);
    expect(unknownEffects('all')).toEqual([]);
  });
});
