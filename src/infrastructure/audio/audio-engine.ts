/**
 * Minimal Web Audio engine for stage 2 (stage 3 grows it into the full
 * procedural soundscape). Owns the AudioContext, master bus and listener;
 * plays pre-rendered buffers through HRTF panners. The context starts
 * suspended until a user gesture (browser autoplay policy).
 */
export interface ListenerPose {
  x: number;
  y: number;
  z: number;
  /** Yaw in radians, Three.js convention (0 looks down -Z). */
  yaw: number;
}

export class AudioEngine {
  readonly context: AudioContext;
  private readonly master: GainNode;
  played = 0;

  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);
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

  setListener(pose: ListenerPose): void {
    const l = this.context.listener;
    const t = this.context.currentTime;
    l.positionX.setValueAtTime(pose.x, t);
    l.positionY.setValueAtTime(pose.y, t);
    l.positionZ.setValueAtTime(pose.z, t);
    l.forwardX.setValueAtTime(-Math.sin(pose.yaw), t);
    l.forwardY.setValueAtTime(0, t);
    l.forwardZ.setValueAtTime(-Math.cos(pose.yaw), t);
    l.upX.setValueAtTime(0, t);
    l.upY.setValueAtTime(1, t);
    l.upZ.setValueAtTime(0, t);
  }

  /** One-shot spatial sound. Nodes are garbage-collected by the browser after `ended`. */
  playAt(buffer: AudioBuffer, x: number, y: number, z: number, gain: number, rate: number): void {
    if (!this.running) return;
    const src = this.context.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.context.createGain();
    g.gain.value = gain;
    const pan = new PannerNode(this.context, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 60,
      rolloffFactor: 1.2,
      positionX: x,
      positionY: y,
      positionZ: z,
    });
    src.connect(g).connect(pan).connect(this.master);
    src.start();
    this.played++;
  }

  dispose(): void {
    void this.context.close();
  }
}
