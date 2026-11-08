import type { AmbientMix } from '../../../domain/audio/mix';
import { createMix } from '../../../domain/audio/mix';
import {
  Creaks,
  Drips,
  Heartbeat,
  Hum,
  Insects,
  Rain,
  RoomTone,
  Rumble,
  Tinnitus,
  Wind,
  type Layer,
} from './layers';
import { Smoother } from './noise';

/**
 * The continuous ambient bed: all layers mixed to stereo with smoothed gains
 * (no zipper noise when the mix changes), a soft clipper on the output, and
 * per-layer RMS meters. Runs inside the AudioWorklet and offline in tests.
 */
export const BLOCK = 128;
export const LAYER_IDS = [
  'wind',
  'hum',
  'insects',
  'drips',
  'creaks',
  'rumble',
  'roomTone',
  'rain',
  'heartbeat',
  'tinnitus',
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export class AmbienceRenderer {
  readonly wind: Wind;
  readonly hum: Hum;
  readonly insects: Insects;
  readonly drips: Drips;
  readonly creaks: Creaks;
  readonly rumble: Rumble;
  readonly roomTone: RoomTone;
  readonly rain: Rain;
  readonly heartbeat: Heartbeat;
  readonly tinnitus: Tinnitus;
  private readonly layers: readonly [LayerId, Layer][];
  private readonly gains: Record<LayerId, Smoother>;
  private readonly targets: Record<LayerId, number>;
  private readonly meterL = new Float32Array(BLOCK);
  private readonly meterR = new Float32Array(BLOCK);
  private readonly energy: Record<LayerId, number>;
  private readonly muted = new Set<LayerId>();
  private meterBlocks = 0;
  mix: AmbientMix = createMix();

  constructor(
    readonly sampleRate: number,
    seed: number,
  ) {
    const sr = sampleRate;
    this.wind = new Wind(sr, seed + 11);
    this.hum = new Hum(sr);
    this.insects = new Insects(sr, seed + 23);
    this.drips = new Drips(sr, seed + 37);
    this.creaks = new Creaks(sr, seed + 41);
    this.rumble = new Rumble(sr, seed + 53);
    this.roomTone = new RoomTone(sr, seed + 61);
    this.rain = new Rain(sr, seed + 71);
    this.heartbeat = new Heartbeat(sr);
    this.tinnitus = new Tinnitus(sr);
    this.layers = [
      ['wind', this.wind],
      ['hum', this.hum],
      ['insects', this.insects],
      ['drips', this.drips],
      ['creaks', this.creaks],
      ['rumble', this.rumble],
      ['roomTone', this.roomTone],
      ['rain', this.rain],
      ['heartbeat', this.heartbeat],
      ['tinnitus', this.tinnitus],
    ];
    const blockRate = sr / BLOCK;
    this.gains = perLayer(() => new Smoother(0, 0.6, blockRate));
    this.targets = perLayer(() => 0);
    this.energy = perLayer(() => 0);
  }

  setMix(m: AmbientMix): void {
    this.mix = m;
    this.wind.gustiness = m.wind.gustiness;
    this.wind.brightness = m.wind.brightness;
    this.hum.freq = m.hum.freq;
    this.hum.harmonics = m.hum.harmonics;
    this.insects.density = m.insects.density;
    this.insects.pitch = m.insects.pitch;
    this.insects.cicada = m.insects.cicada;
    this.drips.rate = m.drips.rate;
    this.drips.pitch = m.drips.pitch;
    this.creaks.ratePerMinute = m.creaks.ratePerMinute;
    this.creaks.metal = m.creaks.metal;
    this.rumble.freq = m.rumble.freq;
    this.roomTone.brightness = m.roomTone.brightness;
    this.heartbeat.bpm = m.heartbeat.bpm;
    const t = this.targets;
    t.wind = m.wind.gain;
    t.hum = m.hum.gain;
    t.insects = m.insects.gain;
    t.drips = m.drips.gain;
    t.creaks = m.creaks.gain;
    t.rumble = m.rumble.gain;
    t.roomTone = m.roomTone.gain;
    t.rain = m.rain.gain;
    t.heartbeat = m.heartbeat.gain;
    t.tinnitus = m.tinnitus.gain;
  }

  /** Debug: silence a layer regardless of the mix. */
  setMuted(id: LayerId, muted: boolean): void {
    if (muted) this.muted.add(id);
    else this.muted.delete(id);
  }

  /** Jump gains to their targets (offline rendering, tests). */
  settle(): void {
    for (const id of LAYER_IDS) this.gains[id].value = this.muted.has(id) ? 0 : this.targets[id];
  }

  /** Renders `left.length` frames (any length; processed in 128-frame blocks). */
  render(left: Float32Array, right: Float32Array): void {
    left.fill(0);
    right.fill(0);
    for (let off = 0; off < left.length; off += BLOCK) {
      const n = Math.min(BLOCK, left.length - off);
      const l = left.subarray(off, off + n);
      const r = right.subarray(off, off + n);
      for (const [id, layer] of this.layers) {
        const gain = this.gains[id].step(this.muted.has(id) ? 0 : this.targets[id]);
        if (gain < 1e-4) continue;
        const ml = this.meterL.subarray(0, n);
        const mr = this.meterR.subarray(0, n);
        ml.fill(0);
        mr.fill(0);
        layer.process(ml, mr, n, gain);
        let e = 0;
        for (let i = 0; i < n; i++) {
          const a = ml[i] ?? 0;
          const b = mr[i] ?? 0;
          l[i] = (l[i] ?? 0) + a;
          r[i] = (r[i] ?? 0) + b;
          e += a * a + b * b;
        }
        this.energy[id] += e / (2 * n);
      }
      // Gentle tanh-style soft clip keeps the bed below full scale whatever the mix does.
      for (let i = 0; i < n; i++) {
        l[i] = softClip(l[i] ?? 0);
        r[i] = softClip(r[i] ?? 0);
      }
      this.meterBlocks++;
    }
  }

  /** Mean-square level per layer since the last call (then resets). */
  takeLevels(): Record<LayerId, number> {
    const blocks = Math.max(1, this.meterBlocks);
    const out = { ...this.energy };
    for (const id of LAYER_IDS) {
      out[id] = Math.sqrt(this.energy[id] / blocks);
      this.energy[id] = 0;
    }
    this.meterBlocks = 0;
    return out;
  }
}

function perLayer<T>(f: (id: LayerId) => T): Record<LayerId, T> {
  return {
    wind: f('wind'),
    hum: f('hum'),
    insects: f('insects'),
    drips: f('drips'),
    creaks: f('creaks'),
    rumble: f('rumble'),
    roomTone: f('roomTone'),
    rain: f('rain'),
    heartbeat: f('heartbeat'),
    tinnitus: f('tinnitus'),
  };
}

function softClip(x: number): number {
  if (x > 1.5) return 1;
  if (x < -1.5) return -1;
  return x - (x * x * x) / 6.75;
}
