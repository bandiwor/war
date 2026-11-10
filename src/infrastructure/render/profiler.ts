import { Ring } from './ring';

/**
 * Rolling frame statistics in fixed-size ring buffers (no per-frame garbage).
 * GPU time uses EXT_disjoint_timer_query_webgl2 when the browser exposes it
 * (often hidden for privacy); results arrive a few frames late.
 */
interface TimerExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

function isTimerExt(v: unknown): v is TimerExt {
  return typeof v === 'object' && v !== null && 'TIME_ELAPSED_EXT' in v && 'GPU_DISJOINT_EXT' in v;
}

export class FrameProfiler {
  readonly frameMs = new Ring();
  readonly cpuMs = new Ring();
  readonly gpuMs = new Ring();
  /** Simulation cost per tick (fed by the game loop). */
  readonly simMs = new Ring();
  drawCalls = 0;
  triangles = 0;
  private lastFrameStart = -1;
  private cpuStart = 0;
  private readonly ext: TimerExt | null;
  private readonly inFlight: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const ext: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.ext = isTimerExt(ext) ? ext : null;
  }

  get gpuTimingAvailable(): boolean {
    return this.ext !== null;
  }

  begin(now: number): void {
    if (this.lastFrameStart >= 0) this.frameMs.push(now - this.lastFrameStart);
    this.lastFrameStart = now;
    this.cpuStart = now;
    if (this.ext !== null && this.inFlight.length < 4) {
      const q = this.gl.createQuery();
      this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
      this.active = q;
    }
  }

  end(now: number, drawCalls: number, triangles: number): void {
    this.cpuMs.push(now - this.cpuStart);
    this.drawCalls = drawCalls;
    this.triangles = triangles;
    if (this.ext !== null && this.active !== null) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.inFlight.push(this.active);
      this.active = null;
    }
    this.poll();
  }

  private poll(): void {
    const ext = this.ext;
    if (ext === null) return;
    const gl = this.gl;
    while (this.inFlight.length > 0) {
      const q = this.inFlight[0];
      if (q === undefined || gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) !== true) break;
      this.inFlight.shift();
      const disjoint: unknown = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns: unknown = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (disjoint !== true && typeof ns === 'number') this.gpuMs.push(ns / 1e6);
      gl.deleteQuery(q);
    }
  }

  get fps(): number {
    const m = this.frameMs.mean();
    return m > 0 ? 1000 / m : 0;
  }
}
