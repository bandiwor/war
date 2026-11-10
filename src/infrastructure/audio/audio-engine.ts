import workletUrl from './ambience.worklet.ts?worker&url';
import type { AudioPort } from '../../application/audio/ports';
import { airAbsorptionCutoff, type RoomAcoustics } from '../../domain/audio/acoustics';
import type { AmbientMix } from '../../domain/audio/mix';
import { DISTANT_KINDS, type DistantKind } from '../../domain/audio/zones';
import { LAYER_IDS, type LayerId } from './dsp/ambience-renderer';
import { synthesizeDistant } from './dsp/distant';
import { generateImpulseResponse } from './dsp/reverb-ir';

/**
 * Web Audio engine.
 *
 *   ambience worklet ─┬─────────────► ambGain ─┐
 *                     └─► ambSend ─┐           │
 *   one-shots ─► gain ─► LPF ─► HRTF panner ─┬─► dry ─┼─► muffle LPF ─► limiter ─► out
 *                                             └─► send ─┴─► convolver A/B (crossfade) ─┘
 *
 * The context starts suspended until a user gesture (autoplay policy).
 */
export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const DISTANT_VARIANTS = 3;
const CROSSFADE = 0.5;

export class AudioEngine implements AudioPort {
  readonly context: AudioContext;
  played = 0;
  localPlayed = 0;
  distantPlayed = 0;
  levels: Partial<Record<LayerId, number>> = {};
  acoustics: RoomAcoustics | null = null;
  workletReady = false;

  private readonly dry: GainNode;
  private readonly send: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly ambGain: GainNode;
  private readonly ambSend: GainNode;
  private readonly convolvers: [ConvolverNode, ConvolverNode];
  private readonly convolverGains: [GainNode, GainNode];
  private activeConvolver = 0;
  private ambience: AudioWorkletNode | null = null;
  private readonly distantBank = new Map<DistantKind, AudioBuffer[]>();
  private readonly listener: ListenerPose = { x: 0, y: 0, z: 0, yaw: 0 };
  private distantPick = 0;
  private lastMixPost = -1;

  private constructor(private readonly seed: number) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.context = ctx;
    this.limiter = new DynamicsCompressorNode(ctx, {
      threshold: -6,
      knee: 4,
      ratio: 12,
      attack: 0.003,
      release: 0.25,
    });
    this.limiter.connect(ctx.destination);
    this.muffle = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.7 });
    this.muffle.connect(this.limiter);
    this.dry = new GainNode(ctx, { gain: 1 });
    this.dry.connect(this.muffle);
    this.send = new GainNode(ctx, { gain: 0.2 });
    this.convolvers = [
      new ConvolverNode(ctx, { disableNormalization: true }),
      new ConvolverNode(ctx, { disableNormalization: true }),
    ];
    this.convolverGains = [new GainNode(ctx, { gain: 1 }), new GainNode(ctx, { gain: 0 })];
    for (let i = 0; i < 2; i++) {
      const conv = this.convolvers[i];
      const gain = this.convolverGains[i];
      if (conv === undefined || gain === undefined) continue;
      this.send.connect(conv).connect(gain).connect(this.muffle);
    }
    this.ambGain = new GainNode(ctx, { gain: 0.8 });
    this.ambGain.connect(this.muffle);
    this.ambSend = new GainNode(ctx, { gain: 0.1 });
    this.ambSend.connect(this.send);
    for (const kind of DISTANT_KINDS) {
      const bank: AudioBuffer[] = [];
      for (let v = 0; v < DISTANT_VARIANTS; v++)
        bank.push(
          this.toBuffer(synthesizeDistant(kind, ctx.sampleRate, seed + v * 131 + kind.length)),
        );
      this.distantBank.set(kind, bank);
    }
  }

  /** Creates the engine; the ambience worklet loads in the background. */
  static create(seed: number): AudioEngine {
    const engine = new AudioEngine(seed);
    void engine.loadWorklet();
    return engine;
  }

  private async loadWorklet(): Promise<void> {
    try {
      await this.context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(this.context, 'war-ambience', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { seed: this.seed },
      });
      node.connect(this.ambGain);
      node.connect(this.ambSend);
      node.port.onmessage = (e: MessageEvent<unknown>) => {
        const data = e.data;
        if (typeof data !== 'object' || data === null || Reflect.get(data, 'type') !== 'levels')
          return;
        const levels: unknown = Reflect.get(data, 'levels');
        if (typeof levels !== 'object' || levels === null) return;
        for (const id of LAYER_IDS) {
          const v: unknown = Reflect.get(levels, id);
          if (typeof v === 'number') this.levels[id] = v;
        }
      };
      this.ambience = node;
      this.workletReady = true;
    } catch (error) {
      console.warn('Ambience worklet unavailable', error);
    }
  }

  /** Call from a user gesture handler. */
  unlock(): void {
    if (this.context.state === 'suspended') void this.context.resume();
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  toBuffer(samples: Float32Array<ArrayBuffer>): AudioBuffer {
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    const p = this.listener;
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    placeListener(this.context.listener, this.context.currentTime, x, y, z, yaw);
  }

  setMix(mix: AmbientMix): void {
    const now = this.context.currentTime;
    this.muffle.frequency.setTargetAtTime(mix.muffleHz, now, 0.25);
    // The worklet smooths gains itself; ~10 updates/s is plenty.
    if (this.ambience !== null && now - this.lastMixPost > 0.08) {
      this.lastMixPost = now;
      this.ambience.port.postMessage({ type: 'mix', mix });
    }
  }

  setLayerMuted(layer: LayerId, muted: boolean): void {
    this.ambience?.port.postMessage({ type: 'mute', layer, muted });
  }

  setAcoustics(a: RoomAcoustics): void {
    this.acoustics = a;
    const ir = generateImpulseResponse(a, this.context.sampleRate, this.seed);
    const buffer = this.context.createBuffer(2, ir.left.length, this.context.sampleRate);
    buffer.copyToChannel(ir.left, 0);
    buffer.copyToChannel(ir.right, 1);
    // Load the idle convolver, then crossfade to it (no clicks, no reverb cut-off).
    const next = 1 - this.activeConvolver;
    const conv = this.convolvers[next];
    const nextGain = this.convolverGains[next];
    const prevGain = this.convolverGains[this.activeConvolver];
    if (conv === undefined || nextGain === undefined || prevGain === undefined) return;
    conv.buffer = buffer;
    const t = this.context.currentTime;
    nextGain.gain.setTargetAtTime(1, t, CROSSFADE / 3);
    prevGain.gain.setTargetAtTime(0, t, CROSSFADE / 3);
    this.activeConvolver = next;
    this.send.gain.setTargetAtTime(a.wet, t, 0.3);
    this.ambSend.gain.setTargetAtTime(0.05 + 0.3 * a.enclosure, t, 0.3);
  }

  /** One-shot spatial sound with optional low-pass (occlusion/air absorption). */
  playAt(
    buffer: AudioBuffer,
    x: number,
    y: number,
    z: number,
    gain: number,
    rate: number,
    cutoffHz = 20000,
  ): void {
    if (!this.running) return;
    const ctx = this.context;
    const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
    const g = new GainNode(ctx, { gain });
    const pan = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 400,
      rolloffFactor: 1.1,
      positionX: x,
      positionY: y,
      positionZ: z,
    });
    let tail: AudioNode = src.connect(g);
    if (cutoffHz < 19000)
      tail = tail.connect(
        new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoffHz, Q: 0.6 }),
      );
    tail.connect(pan);
    pan.connect(this.dry);
    pan.connect(this.send);
    src.start();
    this.played++;
  }

  /**
   * Head-locked one-shot for sounds made by the player (own weapon, own
   * hands). No HRTF: a source a few centimetres from the listener has no
   * meaningful direction, and the panner would render it as "below the
   * chin". Still feeds the geometry reverb, so shots ring in the space.
   */
  playLocal(buffer: AudioBuffer, gain: number, rate: number, pan = 0, reverb = 1): void {
    if (!this.running) return;
    const ctx = this.context;
    const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
    const g = new GainNode(ctx, { gain });
    const p = new StereoPannerNode(ctx, { pan });
    src.connect(g).connect(p);
    p.connect(this.dry);
    if (reverb > 0) {
      const send = new GainNode(ctx, { gain: reverb });
      p.connect(send).connect(this.send);
    }
    src.start();
    this.played++;
    this.localPlayed++;
  }

  playDistant(
    kind: DistantKind,
    x: number,
    y: number,
    z: number,
    occlusion: { gain: number; cutoffHz: number },
  ): void {
    const bank = this.distantBank.get(kind);
    if (bank === undefined || bank.length === 0) return;
    const buffer = bank[this.distantPick++ % bank.length];
    if (buffer === undefined) return;
    const p = this.listener;
    const distance = Math.hypot(x - p.x, y - p.y, z - p.z);
    const cutoff = Math.min(occlusion.cutoffHz, airAbsorptionCutoff(distance));
    // Distant sources are authored loud: the inverse distance model brings them down.
    this.playAt(
      buffer,
      x,
      y,
      z,
      14 * occlusion.gain,
      0.97 + 0.06 * ((this.distantPick * 0.618) % 1),
      cutoff,
    );
    this.distantPlayed++;
  }

  dispose(): void {
    void this.context.close();
  }
}

/**
 * Moves the Web Audio listener. Chrome and Safari expose position and
 * orientation as AudioParams; Firefox still only has the older
 * setPosition/setOrientation methods (`listener.positionX` is undefined there),
 * so feature-detect and fall back.
 */
export function placeListener(
  l: AudioListener,
  t: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const param: unknown = Reflect.get(l, 'positionX');
  if (typeof AudioParam !== 'undefined' && param instanceof AudioParam) {
    l.positionX.setValueAtTime(x, t);
    l.positionY.setValueAtTime(y, t);
    l.positionZ.setValueAtTime(z, t);
    l.forwardX.setValueAtTime(fx, t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(fz, t);
    l.upX.setValueAtTime(0, t);
    l.upY.setValueAtTime(1, t);
    l.upZ.setValueAtTime(0, t);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Firefox has no listener AudioParams; these methods are its only API
  l.setPosition(x, y, z);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- as above
  l.setOrientation(fx, 0, fz, 0, 1, 0);
}
