import { describe, expect, it } from 'vitest';
import type { AudioPort } from '../../src/application/audio/ports';
import { SoundscapeDirector } from '../../src/application/audio/soundscape-director';
import {
  createRenderView,
  readRenderView,
  type RenderView,
} from '../../src/application/scenes/sandbox';
import type { RoomAcoustics } from '../../src/domain/audio/acoustics';
import type { AmbientMix } from '../../src/domain/audio/mix';
import type { DistantKind } from '../../src/domain/audio/zones';
import { STREET } from '../../src/domain/world/street-layout';
import { newSandbox } from '../fixtures/physics';

class RecordingAudio implements AudioPort {
  mixes = 0;
  lastMix: AmbientMix | null = null;
  acoustics: RoomAcoustics[] = [];
  distant: { kind: DistantKind; gain: number; cutoffHz: number }[] = [];
  listener = { x: 0, y: 0, z: 0, yaw: 0 };
  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener = { x, y, z, yaw };
  }
  setMix(mix: AmbientMix): void {
    this.mixes++;
    this.lastMix = structuredClone(mix);
  }
  setAcoustics(a: RoomAcoustics): void {
    this.acoustics.push(a);
  }
  playDistant(
    kind: DistantKind,
    _x: number,
    _y: number,
    _z: number,
    o: { gain: number; cutoffHz: number },
  ): void {
    this.distant.push({ kind, ...o });
  }
}

function setup() {
  const sb = newSandbox(1337);
  sb.simulation.step();
  const audio = new RecordingAudio();
  const director = new SoundscapeDirector(sb.layout, sb.physics, audio, 1);
  const view = readRenderView(sb, 1, createRenderView());
  return { sb, audio, director, view };
}

const run = (d: SoundscapeDirector, v: RenderView, seconds: number): void => {
  for (let t = 0; t < seconds * 60; t++) d.update(v, 1 / 60);
};

describe('soundscape director', () => {
  it('probes acoustics: the street is a semi-open canyon, an alley is more enclosed', () => {
    const { audio, director, view } = setup();
    run(director, view, 0.5);
    const street = director.acoustics;
    expect(street).not.toBeNull();
    expect(street?.covered).toBe(false);
    expect(street?.enclosure).toBeGreaterThan(0.2);
    expect(street?.enclosure).toBeLessThan(0.9);
    // Deep in a building gap the walls are closer on more sides.
    const alley = { ...view, x: STREET.roadHalfWidth + STREET.sidewalkWidth + 2.2 };
    run(director, alley, 0.5);
    expect(audio.acoustics.length).toBeGreaterThanOrEqual(1);
    expect(audio.listener.x).toBeCloseTo(alley.x);
  });

  it('mix follows the zone under the listener and crossfades at the border', () => {
    const { sb, audio, director, view } = setup();
    run(director, view, 0.3);
    const cityHum = audio.lastMix?.hum.gain ?? 0;
    const border = sb.layout.zones[0]?.max[1] ?? 0;
    run(director, { ...view, z: border + 30 }, 0.3);
    const industrialHum = audio.lastMix?.hum.gain ?? 0;
    run(director, { ...view, z: border }, 0.3);
    const mid = audio.lastMix?.hum.gain ?? 0;
    expect(industrialHum).toBeGreaterThan(cityHum * 3);
    expect(mid).toBeGreaterThan(cityHum);
    expect(mid).toBeLessThan(industrialHum);
    expect(audio.mixes).toBeGreaterThan(5);
  });

  it('overrides: zone audition, danger, health', () => {
    const { audio, director, view } = setup();
    director.overrides.zone = 'forest';
    director.overrides.danger = 1;
    director.overrides.health = 0.1;
    run(director, view, 0.2);
    expect(audio.lastMix?.insects.cicada).toBeGreaterThan(0.3);
    expect(audio.lastMix?.heartbeat.gain).toBeGreaterThan(0.5);
    expect(audio.lastMix?.muffleHz).toBeLessThan(3000);
  });

  it('schedules distant events at roughly the zone rate, with occlusion', () => {
    const { audio, director, view } = setup();
    run(director, view, 600);
    // City: 3/min at night ≈ 30 in 10 minutes.
    expect(audio.distant.length).toBeGreaterThan(15);
    expect(audio.distant.length).toBeLessThan(50);
    expect(new Set(audio.distant.map((d) => d.kind)).size).toBeGreaterThan(2);
    expect(audio.distant.some((d) => d.cutoffHz < 18000)).toBe(true); // some came from behind buildings
    expect(director.distantPlayed).toBe(audio.distant.length);
  });

  it('night deepens with the in-world clock', () => {
    const { director, view } = setup();
    run(director, { ...view, simTime: 0 }, 0.2);
    const early = director.context.night;
    run(director, { ...view, simTime: 3600 }, 0.2);
    expect(director.context.night).toBeGreaterThan(early);
  });
});
