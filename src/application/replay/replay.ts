import { z } from 'zod';
import { InputCommandSchema, type InputCommand } from '../../domain/input/commands';
import { seed as toSeed, type Seed } from '../../domain/core/brand';
import type { Simulation } from '../simulation';

/**
 * Replay = seed + the commands issued on each tick. Stored sparsely (only
 * ticks with input) so files stay small and diffs stay readable.
 */
export const REPLAY_VERSION = 1;

export const ReplaySchema = z.object({
  format: z.literal('war-replay'),
  version: z.literal(REPLAY_VERSION),
  seed: z.number().int().min(0).max(0xffffffff),
  tickRate: z.number().int().positive(),
  length: z.number().int().nonnegative(),
  frames: z.array(
    z.object({ t: z.number().int().nonnegative(), c: z.array(InputCommandSchema).min(1) }),
  ),
  checkpoints: z.array(z.object({ t: z.number().int().nonnegative(), hash: z.string() })),
});

export type Replay = z.infer<typeof ReplaySchema>;

export function parseReplay(json: unknown): Replay {
  const replay = ReplaySchema.parse(json);
  let prev = -1;
  for (const frame of replay.frames) {
    if (frame.t <= prev)
      throw new Error(`Replay frames not strictly increasing at t=${String(frame.t)}`);
    if (frame.t >= replay.length)
      throw new Error(`Replay frame t=${String(frame.t)} beyond length`);
    prev = frame.t;
  }
  return replay;
}

export class ReplayRecorder {
  private readonly frames: { t: number; c: InputCommand[] }[] = [];
  private readonly checkpoints: { t: number; hash: string }[] = [];
  private length = 0;

  constructor(
    private readonly seed: Seed,
    private readonly tickRate: number,
    /** Store a state-hash checkpoint every N ticks (0 = never). */
    private readonly checkpointEvery = 0,
  ) {}

  /** Call with the commands applied on `tick`, before stepping. */
  record(tick: number, commands: readonly InputCommand[]): void {
    if (tick !== this.length)
      throw new Error(`Expected tick ${String(this.length)}, got ${String(tick)}`);
    if (commands.length > 0) this.frames.push({ t: tick, c: commands.map((c) => ({ ...c })) });
    this.length++;
  }

  /** Call after stepping; records a checkpoint when due. */
  afterStep(sim: Simulation): void {
    if (this.checkpointEvery > 0 && sim.tick % this.checkpointEvery === 0) {
      this.checkpoints.push({ t: sim.tick, hash: sim.stateHash() });
    }
  }

  finish(): Replay {
    return {
      format: 'war-replay',
      version: REPLAY_VERSION,
      seed: this.seed,
      tickRate: this.tickRate,
      length: this.length,
      frames: this.frames.map((f) => ({ t: f.t, c: f.c.map((c) => ({ ...c })) })),
      checkpoints: this.checkpoints.map((c) => ({ ...c })),
    };
  }
}

export interface PlaybackResult {
  readonly finalHash: string;
  readonly ticks: number;
  /** First checkpoint whose hash did not match, if any. */
  readonly divergence: {
    readonly t: number;
    readonly expected: string;
    readonly actual: string;
  } | null;
}

/** Runs a replay on a fresh simulation built by `create`, verifying checkpoints. */
export function playReplay(replay: Replay, create: (seed: Seed) => Simulation): PlaybackResult {
  const sim = create(toSeed(replay.seed));
  if (sim.tickRate !== replay.tickRate) {
    throw new Error(
      `Replay tickRate ${String(replay.tickRate)} != simulation ${String(sim.tickRate)}`,
    );
  }
  const checkpoints = new Map(replay.checkpoints.map((c) => [c.t, c.hash]));
  let frameIdx = 0;
  let divergence: PlaybackResult['divergence'] = null;
  for (let t = 0; t < replay.length; t++) {
    const frame = replay.frames[frameIdx];
    if (frame?.t === t) {
      sim.step(frame.c);
      frameIdx++;
    } else {
      sim.step();
    }
    const expected = checkpoints.get(sim.tick);
    if (divergence === null && expected !== undefined) {
      const actual = sim.stateHash();
      if (actual !== expected) divergence = { t: sim.tick, expected, actual };
    }
  }
  return { finalHash: sim.stateHash(), ticks: replay.length, divergence };
}

/** Stable, diff-friendly JSON: one frame / checkpoint per line. */
export function formatReplay(replay: Replay): string {
  const { frames, checkpoints, ...header } = replay;
  const lines = (items: readonly unknown[]): string =>
    items.length === 0
      ? '[]'
      : '[\n' + items.map((i) => '    ' + JSON.stringify(i)).join(',\n') + '\n  ]';
  const head = Object.entries(header).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return `{\n${head.join(',\n')},\n  "frames": ${lines(frames)},\n  "checkpoints": ${lines(checkpoints)}\n}\n`;
}
