import { z } from 'zod';
import { InputCommandSchema, type InputCommand } from '../../domain/input/commands';
import { seed as toSeed, type Seed } from '../../domain/core/brand';
import type { Simulation } from '../simulation';
import { SaveSchema, type SaveGame } from '../../domain/save/save';

/**
 * Replay = seed + the commands issued on each tick. Stored sparsely (only
 * ticks with input) so files stay small and diffs stay readable.
 */
export const REPLAY_VERSION = 3;

/** Scenes a replay can target; playback refuses to run a replay on the wrong scene. */
export const REPLAY_SCENES = ['empty', 'sandbox', 'range', 'world'] as const;
export type ReplayScene = (typeof REPLAY_SCENES)[number];

const Frames = z.array(
  z.object({ t: z.number().int().nonnegative(), c: z.array(InputCommandSchema).min(1) }),
);
const Checkpoints = z.array(z.object({ t: z.number().int().nonnegative(), hash: z.string() }));

const ReplayV1Schema = z.object({
  format: z.literal('war-replay'),
  version: z.literal(1),
  seed: z.number().int().min(0).max(0xffffffff),
  tickRate: z.number().int().positive(),
  length: z.number().int().nonnegative(),
  frames: Frames,
  checkpoints: Checkpoints,
});

const ReplayV2Schema = z.object({
  format: z.literal('war-replay'),
  version: z.literal(2),
  scene: z.enum(REPLAY_SCENES),
  seed: z.number().int().min(0).max(0xffffffff),
  tickRate: z.number().int().positive(),
  length: z.number().int().nonnegative(),
  frames: Frames,
  checkpoints: Checkpoints,
});

export const ReplaySchema = z.object({
  format: z.literal('war-replay'),
  version: z.literal(REPLAY_VERSION),
  /** The save the session started from (stage 8), or null for a new game. */
  save: SaveSchema.nullable(),
  scene: z.enum(REPLAY_SCENES),
  seed: z.number().int().min(0).max(0xffffffff),
  tickRate: z.number().int().positive(),
  length: z.number().int().nonnegative(),
  frames: Frames,
  checkpoints: Checkpoints,
});

export type Replay = z.infer<typeof ReplaySchema>;

/**
 * Migrations keyed by source version. v1 (stage 0) predates scenes: every v1
 * replay was recorded on the empty world. v2 (stages 2–7) predates saves:
 * every v2 session started a new game.
 */
function migrate(json: unknown): unknown {
  const version: unknown =
    typeof json === 'object' && json !== null ? Reflect.get(json, 'version') : undefined;
  let v = json;
  if (version === 1) v = { ...ReplayV1Schema.parse(v), version: 2, scene: 'empty' };
  if (version === 1 || version === 2) v = { ...ReplayV2Schema.parse(v), version: 3, save: null };
  return v;
}

export function parseReplay(json: unknown): Replay {
  const replay = ReplaySchema.parse(migrate(json));
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
    private readonly scene: ReplayScene,
    private readonly seed: Seed,
    private readonly tickRate: number,
    /** Store a state-hash checkpoint every N ticks (0 = never). */
    private readonly checkpointEvery = 0,
    /** The save this session was loaded from (null = a new game). */
    private readonly save: SaveGame | null = null,
  ) {}

  get ticks(): number {
    return this.length;
  }

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
      save: this.save,
      scene: this.scene,
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

/**
 * Runs a replay on a fresh simulation built by `create` (which must apply
 * `save` when there is one), verifying checkpoints.
 */
export function playReplay(
  replay: Replay,
  create: (seed: Seed, save: SaveGame | null) => Simulation,
): PlaybackResult {
  const sim = create(toSeed(replay.seed), replay.save);
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
