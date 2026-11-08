/**
 * AudioWorklet processor for the ambient bed. Runs the same pure DSP
 * (AmbienceRenderer) as the offline tests, on the audio thread, so the main
 * thread only sends mix updates.
 */
import { AmbienceRenderer, LAYER_IDS, type LayerId } from './dsp/ambience-renderer';
import type { AmbientMix } from '../../domain/audio/mix';

interface ProcessorBase {
  readonly port: MessagePort;
}
interface WorkletScope {
  readonly sampleRate: number;
  readonly AudioWorkletProcessor: new () => ProcessorBase;
  registerProcessor(
    name: string,
    ctor: new (options: { processorOptions?: unknown }) => ProcessorBase,
  ): void;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- AudioWorkletGlobalScope is not in the DOM typings this project compiles against
const scope = globalThis as unknown as WorkletScope;

export const PROCESSOR_NAME = 'war-ambience';

function isLayerId(v: unknown): v is LayerId {
  return typeof v === 'string' && LAYER_IDS.some((id) => id === v);
}

/** Messages come only from our own AudioEngine; checked structurally anyway. */
function isMix(v: unknown): v is AmbientMix {
  return typeof v === 'object' && v !== null && 'wind' in v && 'hum' in v && 'heartbeat' in v;
}

class AmbienceProcessor extends scope.AudioWorkletProcessor {
  private readonly renderer: AmbienceRenderer;
  private blocks = 0;

  constructor(options: { processorOptions?: unknown }) {
    super();
    const seedValue: unknown =
      typeof options.processorOptions === 'object' && options.processorOptions !== null
        ? Reflect.get(options.processorOptions, 'seed')
        : 0;
    this.renderer = new AmbienceRenderer(
      scope.sampleRate,
      typeof seedValue === 'number' ? seedValue : 0,
    );
    this.port.onmessage = (e: MessageEvent<unknown>) => {
      const msg = e.data;
      if (typeof msg !== 'object' || msg === null) return;
      const type: unknown = Reflect.get(msg, 'type');
      if (type === 'mix') {
        const mix: unknown = Reflect.get(msg, 'mix');
        if (isMix(mix)) this.renderer.setMix(mix);
      } else if (type === 'mute') {
        const layer: unknown = Reflect.get(msg, 'layer');
        if (isLayerId(layer)) this.renderer.setMuted(layer, Reflect.get(msg, 'muted') === true);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out?.[0];
    const right = out?.[1] ?? left;
    if (left === undefined || right === undefined) return true;
    this.renderer.render(left, right);
    // Report per-layer levels ~4×/s for the debug meters.
    if (++this.blocks >= Math.round(scope.sampleRate / 128 / 4)) {
      this.blocks = 0;
      this.port.postMessage({ type: 'levels', levels: this.renderer.takeLevels() });
    }
    return true;
  }
}

scope.registerProcessor(PROCESSOR_NAME, AmbienceProcessor);
