import { EFFECT_IDS, isEffectId, type PostFxConfig } from '../domain/bodycam/effects';
import type { BodycamStimulus } from '../domain/bodycam/stimulus';
import { isQualityName, type QualityName } from '../infrastructure/render/quality';

/**
 * URL options (useful for testing and sharing a look):
 *   ?seed=1337          world seed
 *   ?quality=low|medium|high
 *   ?fx=none | all | a,b,c   which bodycam effects start enabled
 *   ?vt=12.5            visual-test mode: frozen render time, simulation not running
 *   ?ticks=120          pre-simulate N ticks (with ?look=yaw,pitch and ?walk=1 for scripted motion)
 *   ?spin=2.5           visual-test mode: fake camera yaw rate (rad/s) for motion effects
 *   ?signal=0.8         force a signal-loss level
 *   ?bench=20           benchmark: scripted walk for N seconds, then a frame-time report
 *   ?replay=session     play back the replay stored by the debug menu (Sim tab)
 *   ?scene=range        the debug shooting range instead of the street
 *   ?stim=damage:0.5,fear:0.2,emi:0
 */
export interface UrlOptions {
  readonly seed: number;
  readonly quality: QualityName;
  readonly fx: 'all' | 'none' | readonly string[];
  readonly frozenTime: number | undefined;
  readonly preTicks: number;
  readonly look: readonly [number, number];
  readonly walk: boolean;
  readonly signal: number;
  readonly spin: number;
  readonly benchSeconds: number;
  readonly replay: 'session' | null;
  readonly scene: 'street' | 'range';
  readonly stimulus: BodycamStimulus | null;
}

function num(v: string | null, fallback: number): number {
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) ? fallback : n;
}

export function parseUrlOptions(search: string): UrlOptions {
  const q = new URLSearchParams(search);
  const fxRaw = q.get('fx') ?? 'all';
  const quality = q.get('quality') ?? 'medium';
  const vt = q.get('vt');
  const [yaw = 0, pitch = 0] = (q.get('look') ?? '').split(',').map((x) => num(x, 0));
  let stimulus: BodycamStimulus | null = null;
  const stim = q.get('stim');
  if (stim !== null) {
    stimulus = { damage: 0, fear: 0, emi: 0 };
    for (const part of stim.split(',')) {
      const [k, v] = part.split(':');
      if (k === 'damage' || k === 'fear' || k === 'emi') stimulus[k] = num(v ?? null, 0);
    }
  }
  return {
    seed: num(q.get('seed'), 1337) >>> 0,
    quality: isQualityName(quality) ? quality : 'medium',
    fx: fxRaw === 'all' || fxRaw === 'none' ? fxRaw : fxRaw.split(',').filter((x) => x.length > 0),
    frozenTime: vt === null ? undefined : num(vt, 12),
    preTicks: Math.max(0, Math.floor(num(q.get('ticks'), 0))),
    look: [yaw, pitch],
    walk: q.get('walk') === '1',
    signal: num(q.get('signal'), 0),
    spin: num(q.get('spin'), 0),
    benchSeconds: Math.max(0, num(q.get('bench'), 0)),
    replay: q.get('replay') === 'session' ? 'session' : null,
    scene: q.get('scene') === 'range' ? 'range' : 'street',
    stimulus,
  };
}

export function applyFxSelection(cfg: PostFxConfig, fx: UrlOptions['fx']): void {
  for (const id of EFFECT_IDS) {
    cfg[id].enabled = fx === 'all' ? true : fx === 'none' ? false : fx.includes(id);
  }
}

export function unknownEffects(fx: UrlOptions['fx']): readonly string[] {
  return typeof fx === 'string' ? [] : fx.filter((id) => !isEffectId(id));
}
