/** Fixed-size ring buffer of samples with mean/percentile (no per-frame garbage). */
const HISTORY = 240;

export class Ring {
  readonly values = new Float32Array(HISTORY);
  private head = 0;
  private filled = 0;

  push(v: number): void {
    this.values[this.head] = v;
    this.head = (this.head + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled++;
  }

  get count(): number {
    return this.filled;
  }

  /** i-th most recent value (0 = latest). */
  recent(i: number): number {
    return this.values[(this.head - 1 - i + HISTORY * 2) % HISTORY] ?? 0;
  }

  mean(): number {
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += this.values[i] ?? 0;
    return this.filled === 0 ? 0 : s / this.filled;
  }

  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const sorted = Array.from(this.values.subarray(0, this.filled)).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  }
}
