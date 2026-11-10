import {
  acousticsChanged,
  estimateAcoustics,
  occlusion,
  probeDirections,
  type ProbeHit,
  type RoomAcoustics,
} from '../../domain/audio/acoustics';
import {
  computeMix,
  createAmbienceContext,
  createMix,
  TYPICAL_WIND,
  type AmbientMix,
} from '../../domain/audio/mix';
import { nightness, sunElevation } from '../../domain/world/environment';
import { DISTANT_KINDS, type DistantKind, type ZoneId } from '../../domain/audio/zones';
import { clamp, cos, sin, TAU } from '../../domain/math/dmath';
import { Rng } from '../../domain/math/prng';
import { zoneWeightsAt, type StreetLayout } from '../../domain/world/street-layout';
import { surfaceAcoustics } from '../../domain/world/surfaces';
import type { PhysicsPort, Point, RayHit } from '../physics/ports';
import type { RenderView } from '../scenes/sandbox';
import type { AudioPort } from './ports';

/**
 * Drives the procedural soundscape from the player's situation. Runs on the
 * render clock (it never changes simulation state), at low rates:
 * acoustics probes 4×/s, mix 10×/s, distant events as a Poisson process.
 */
export interface SoundscapeOverrides {
  zone: ZoneId | null;
  danger: number | null;
  enemyProximity: number | null;
  health: number | null;
  rain: number | null;
  night: number | null;
  wind: number | null;
}

const PROBE_RANGE = 40;
const PROBE_INTERVAL = 0.25;
const MIX_INTERVAL = 0.1;
/** In-world clock starts at 21:40; it is full night by ~23:00. */
const NIGHT_START = 0.65;
const NIGHT_RAMP_SECONDS = 80 * 60;

export class SoundscapeDirector {
  readonly context = createAmbienceContext();
  readonly mix: AmbientMix = createMix();
  readonly overrides: SoundscapeOverrides = {
    zone: null,
    danger: null,
    enemyProximity: null,
    health: null,
    rain: null,
    night: null,
    wind: null,
  };
  acoustics: RoomAcoustics | null = null;
  distantPlayed = 0;
  lastDistant: DistantKind | null = null;

  private readonly rng: Rng;
  private readonly directions = probeDirections();
  private readonly hits: ProbeHit[];
  private readonly hit: RayHit = { distance: 0, surface: null, nx: 0, ny: 0, nz: 0 };
  private readonly origin: Point = { x: 0, y: 0, z: 0 };
  private readonly dir: Point = { x: 0, y: 0, z: 0 };
  private probeTimer = 0;
  private mixTimer = 0;

  constructor(
    private readonly layout: StreetLayout,
    private readonly physics: PhysicsPort,
    private readonly audio: AudioPort,
    seed: number,
  ) {
    this.rng = Rng.fromSeed(seed ^ 0xa0d10);
    this.hits = this.directions.map((d) => ({ ...d, distance: null, absorption: 0 }));
  }

  /** Call every rendered frame with wall-clock delta seconds. */
  update(view: RenderView, dt: number): void {
    this.audio.setListener(view.x, view.y, view.z, view.yaw);
    this.probeTimer -= dt;
    if (this.probeTimer <= 0 || this.acoustics === null) {
      this.probeTimer = PROBE_INTERVAL;
      this.probe(view);
    }
    this.mixTimer -= dt;
    if (this.mixTimer <= 0) {
      this.mixTimer = MIX_INTERVAL;
      this.updateMix(view);
    }
    this.maybeDistant(view, dt);
  }

  private probe(view: RenderView): void {
    this.origin.x = view.x;
    this.origin.y = view.y;
    this.origin.z = view.z;
    for (let i = 0; i < this.directions.length; i++) {
      const d = this.directions[i];
      const h = this.hits[i];
      if (d === undefined || h === undefined) continue;
      this.dir.x = d.dx;
      this.dir.y = d.dy;
      this.dir.z = d.dz;
      if (this.physics.raycast(this.origin, this.dir, PROBE_RANGE, this.hit)) {
        h.distance = this.hit.distance;
        h.absorption =
          this.hit.surface === null ? 0.3 : surfaceAcoustics(this.hit.surface).absorption;
      } else {
        h.distance = null;
      }
    }
    const next = estimateAcoustics(this.hits, PROBE_RANGE, view.yaw);
    if (this.acoustics === null || acousticsChanged(this.acoustics, next)) {
      this.acoustics = next;
      this.audio.setAcoustics(next);
    }
  }

  private updateMix(view: RenderView): void {
    const o = this.overrides;
    const c = this.context;
    c.zones = o.zone !== null ? { [o.zone]: 1 } : zoneWeightsAt(this.layout, view.x, view.z);
    const env = view.env;
    // Scenes with a world clock take night from the sun; the fixed street keeps its slow ramp.
    c.night =
      o.night ??
      (env.active
        ? nightness(sunElevation(env.timeOfDay))
        : clamp(NIGHT_START + ((1 - NIGHT_START) * view.simTime) / NIGHT_RAMP_SECONDS, 0, 1));
    c.danger = o.danger ?? 0;
    c.enemyProximity = o.enemyProximity ?? 0;
    c.health = o.health ?? 1;
    c.rain = o.rain ?? (env.active ? env.weather.rain : 0);
    c.wind = o.wind ?? (env.active ? env.weather.wind : TYPICAL_WIND);
    // Covered + enclosed reads as "indoors" (tunnel, interior); a street canyon is not.
    const a = this.acoustics;
    c.indoor = a === null ? 0 : clamp((a.enclosure - 0.5) * 2, 0, 1) * (a.covered ? 1 : 0.3);
    computeMix(c, this.mix);
    this.audio.setMix(this.mix);
  }

  private maybeDistant(view: RenderView, dt: number): void {
    const rate = this.mix.distantRatePerMinute / 60;
    if (rate <= 0 || dt <= 0 || dt > 1) return;
    if (this.rng.nextFloat() >= rate * dt) return;
    const kind = this.pickKind();
    if (kind === null) return;
    const azimuth = this.rng.range(0, TAU);
    const distance = this.rng.range(45, 160);
    const x = view.x + sin(azimuth) * distance;
    const z = view.z - cos(azimuth) * distance;
    const y = view.y + this.rng.range(0, 8);
    this.audio.playDistant(kind, x, y, z, occlusion(this.blockedFraction(view, x, y, z, distance)));
    this.distantPlayed++;
    this.lastDistant = kind;
  }

  private pickKind(): DistantKind | null {
    let total = 0;
    for (const k of DISTANT_KINDS) total += this.mix.distantWeights[k];
    if (total <= 0) return null;
    let r = this.rng.nextFloat() * total;
    for (const k of DISTANT_KINDS) {
      r -= this.mix.distantWeights[k];
      if (r < 0) return k;
    }
    return DISTANT_KINDS[DISTANT_KINDS.length - 1] ?? null;
  }

  /** Three rays (centre, up-left, up-right) toward the source; fraction that hit something first. */
  private blockedFraction(
    view: RenderView,
    x: number,
    y: number,
    z: number,
    distance: number,
  ): number {
    let blocked = 0;
    for (let i = 0; i < 3; i++) {
      this.origin.x = view.x;
      this.origin.y = view.y + (i === 0 ? 0 : 0.8);
      this.origin.z = view.z;
      const dx = x - this.origin.x + (i === 1 ? 1.5 : i === 2 ? -1.5 : 0);
      const dy = y - this.origin.y;
      const dz = z - this.origin.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.dir.x = dx / len;
      this.dir.y = dy / len;
      this.dir.z = dz / len;
      if (
        this.physics.raycast(this.origin, this.dir, Math.min(distance, PROBE_RANGE * 2), this.hit)
      )
        blocked++;
    }
    return blocked / 3;
  }
}
